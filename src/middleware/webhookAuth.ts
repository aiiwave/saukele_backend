import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../config/env';
import { AppError } from './errorHandler';

/**
 * Verifies Kaspi Pay webhook HMAC-SHA256 signature.
 * Kaspi sends the signature in the X-Kaspi-Signature header.
 * Requires raw body buffer — use express.raw() before this middleware.
 */
export function verifyKaspiWebhook(req: Request, _res: Response, next: NextFunction): void {
  const signature = req.headers['x-kaspi-signature'] as string;
  const secret = env.KASPI_WEBHOOK_SECRET;

  if (!secret) return next(new AppError(500, 'CONFIG_ERROR', 'Kaspi webhook secret not configured'));
  if (!signature) return next(new AppError(401, 'UNAUTHORIZED', 'Missing Kaspi webhook signature'));

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) return next(new AppError(400, 'BAD_REQUEST', 'Missing raw request body'));

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSig, 'hex'),
  );

  if (!isValid) return next(new AppError(401, 'UNAUTHORIZED', 'Invalid Kaspi webhook signature'));

  next();
}

/**
 * Verifies Stripe webhook signature using Stripe's timestamp-based scheme.
 * Signature is in the Stripe-Signature header.
 */
export function verifyStripeWebhook(req: Request, _res: Response, next: NextFunction): void {
  const signature = req.headers['stripe-signature'] as string;
  const secret = env.STRIPE_WEBHOOK_SECRET;

  if (!secret) return next(new AppError(500, 'CONFIG_ERROR', 'Stripe webhook secret not configured'));
  if (!signature) return next(new AppError(401, 'UNAUTHORIZED', 'Missing Stripe webhook signature'));

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) return next(new AppError(400, 'BAD_REQUEST', 'Missing raw request body'));

  // Parse Stripe's t=timestamp,v1=signature format
  const parts: Record<string, string> = {};
  signature.split(',').forEach((part) => {
    const [k, v] = part.split('=');
    if (k && v) parts[k] = v;
  });

  if (!parts['t'] || !parts['v1']) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Malformed Stripe signature header'));
  }

  const signedPayload = `${parts['t']}.${rawBody.toString('utf-8')}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(parts['v1'], 'hex'),
    Buffer.from(expectedSig, 'hex'),
  );

  if (!isValid) return next(new AppError(401, 'UNAUTHORIZED', 'Invalid Stripe webhook signature'));

  // Replay attack prevention: reject webhooks older than 5 minutes
  const timestamp = parseInt(parts['t'], 10);
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (timestamp < fiveMinutesAgo) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Stripe webhook timestamp too old'));
  }

  next();
}

import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { getRedis } from '../config/redis';
import { AppError } from './errorHandler';

function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

function createRedisLimiter(keyPrefix: string, points: number, duration: number) {
  return new RateLimiterRedis({
    storeClient: getRedis(),
    keyPrefix,
    points,      // max requests
    duration,    // per seconds
    blockDuration: duration, // block for the same window after limit hit
  });
}

// Auth endpoints: 5 attempts per minute per IP (spec requirement)
let authLimiter: RateLimiterRedis | null = null;

function getAuthLimiter(): RateLimiterRedis {
  if (!authLimiter) authLimiter = createRedisLimiter('rl_auth', 5, 60);
  return authLimiter;
}

// Public endpoints: 100 requests per minute per IP
let publicLimiter: RateLimiterRedis | null = null;

function getPublicLimiter(): RateLimiterRedis {
  if (!publicLimiter) publicLimiter = createRedisLimiter('rl_public', 100, 60);
  return publicLimiter;
}

// Admin endpoints: 500 requests per minute per IP
let adminLimiter: RateLimiterRedis | null = null;

function getAdminLimiter(): RateLimiterRedis {
  if (!adminLimiter) adminLimiter = createRedisLimiter('rl_admin', 500, 60);
  return adminLimiter;
}

function makeLimiterMiddleware(getLimiter: () => RateLimiterRedis) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = getClientIp(req);
    try {
      const result = await getLimiter().consume(ip);
      res.setHeader('X-RateLimit-Remaining', result.remainingPoints);
      next();
    } catch {
      res.setHeader('Retry-After', '60');
      next(new AppError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests. Please try again later.'));
    }
  };
}

export const authRateLimiter = makeLimiterMiddleware(getAuthLimiter);
export const publicRateLimiter = makeLimiterMiddleware(getPublicLimiter);
export const adminRateLimiter = makeLimiterMiddleware(getAdminLimiter);

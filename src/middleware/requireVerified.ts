import { Request, Response, NextFunction } from 'express';
import { userRepository } from '../repositories/userRepository';
import { ForbiddenError, UnauthorizedError } from './errorHandler';

/**
 * Block unverified users from business endpoints.
 *
 * Why this isn't baked into the JWT payload: verification status can change
 * mid-session (user clicks the verify link in another tab), and we don't want
 * to force a token refresh to honor that. So we read fresh from the DB.
 *
 * Cost is one indexed `findById` per protected request; acceptable for the
 * defense-grade scope.
 */
export async function requireVerified(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) return next(new UnauthorizedError('Authentication required'));

  try {
    const user = await userRepository.findById(req.user.sub);
    if (!user) return next(new UnauthorizedError('User not found'));
    if (!user.isVerified) {
      return next(
        new ForbiddenError(
          'Email verification required. Please verify your email before accessing this resource.',
        ),
      );
    }
    next();
  } catch (err) {
    next(err);
  }
}

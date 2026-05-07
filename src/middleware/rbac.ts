import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from './errorHandler';

/**
 * RBAC middleware factory.
 * Usage: router.get('/admin', authenticate, requireRole('ADMIN'), handler)
 *
 * Returns 401 if user is not authenticated (req.user missing).
 * Returns 403 (not 401) if user IS authenticated but lacks the required role.
 */
export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Access denied. Required role(s): ${allowedRoles.join(', ')}. Your role: ${req.user.role}`,
        ),
      );
    }

    next();
  };
}

/** Shorthand guards */
export const requireAdmin = requireRole(Role.ADMIN);
export const requireCouple = requireRole(Role.COUPLE, Role.ADMIN);
export const requireGuest = requireRole(Role.GUEST, Role.COUPLE, Role.ADMIN, Role.DELIVERY_PARTNER);

import { Router } from 'express';
import { authController } from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimiter';

const router = Router();

/**
 * @openapi POST /auth/register
 * Rate-limited: 5/min per IP
 */
router.post('/register', authRateLimiter, authController.register);

/**
 * @openapi POST /auth/login
 * Rate-limited: 5/min per IP
 */
router.post('/login', authRateLimiter, authController.login);

/**
 * @openapi POST /auth/refresh
 * Exchange valid refresh token for new access token
 */
router.post('/refresh', authController.refresh);

/**
 * @openapi POST /auth/logout
 * Revoke a specific refresh token (requires access token)
 */
router.post('/logout', authenticate, authController.logout);

/**
 * @openapi POST /auth/logout-all
 * Revoke ALL refresh tokens for the authenticated user
 */
router.post('/logout-all', authenticate, authController.logoutAll);

/**
 * @openapi GET /auth/me
 * Get current user profile
 */
router.get('/me', authenticate, authController.me);

// ─── Email verification ──────────────────────────────────────────────────────
/**
 * @openapi POST /auth/verify-email
 * Confirm an email-verification token. Token can also be supplied as ?token=… on a GET.
 */
router.post('/verify-email', authController.verifyEmail);
router.get('/verify-email', authController.verifyEmail);

/**
 * @openapi POST /auth/resend-verification
 * Re-issue a verification email. Always returns 200 to avoid email enumeration.
 * Rate-limited.
 */
router.post('/resend-verification', authRateLimiter, authController.resendVerification);

// ─── Password reset ──────────────────────────────────────────────────────────
/**
 * @openapi POST /auth/forgot-password
 * Request a password reset email. Always returns 200 (no enumeration). Rate-limited.
 */
router.post('/forgot-password', authRateLimiter, authController.forgotPassword);

/**
 * @openapi POST /auth/reset-password
 * Consume a reset token + set a new password. Revokes all existing sessions.
 */
router.post('/reset-password', authController.resetPassword);

export default router;

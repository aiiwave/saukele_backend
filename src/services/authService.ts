import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Role, User } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { userRepository } from '../repositories/userRepository';
import { ConflictError, UnauthorizedError, ValidationError, AppError, NotFoundError } from '../middleware/errorHandler';
import { JwtPayload } from '../middleware/auth';
import { enqueueEmail } from '../jobs/emailQueue';

const BCRYPT_ROUNDS = 12;
const EMAIL_VERIFICATION_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_MINUTES = 30;

/** SHA-256 hash a token before storing it. The raw value never touches the DB. */
function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

// ─── Zod Validation Schemas ───────────────────────────────────────────────────

export const RegisterSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z
      .string()
      .regex(/^\+7\d{10}$/, 'Phone must be in +7XXXXXXXXXX format')
      .optional(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Password must contain at least one digit')
      .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
    role: z.enum([Role.GUEST, Role.COUPLE]).default(Role.GUEST),
  })
  .refine((d) => d.email || d.phone, {
    message: 'Either email or phone is required',
  });

export const LoginSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().optional(),
    password: z.string().min(1, 'Password is required'),
  })
  .refine((d) => d.email || d.phone, {
    message: 'Either email or phone is required',
  });

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const VerifyEmailSchema = z.object({
  token: z.string().min(10, 'Verification token is required'),
});

export const ResendVerificationSchema = z.object({
  email: z.string().email(),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const ResetPasswordSchema = z.object({
  token: z.string().min(10, 'Reset token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one digit')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});

// ─── Token Utilities ─────────────────────────────────────────────────────────

function signAccessToken(user: User): string {
  return jwt.sign(
    { sub: user.id, role: user.role } satisfies Omit<JwtPayload, 'iat' | 'exp'>,
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN } as jwt.SignOptions,
  );
}

function signRefreshToken(userId: string): string {
  return jwt.sign(
    { sub: userId, type: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN } as jwt.SignOptions,
  );
}

function parseRefreshExpiry(): Date {
  // Parse "7d", "30d", etc. into a Date
  const raw = env.JWT_REFRESH_EXPIRES_IN;
  const days = parseInt(raw.replace('d', ''), 10) || 7;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

// ─── Auth Service ─────────────────────────────────────────────────────────────

export const authService = {
  async register(input: z.infer<typeof RegisterSchema>) {
    // Check for existing user
    const existing = await userRepository.findByEmailOrPhone(input.email, input.phone);
    if (existing) {
      throw new ConflictError(
        input.email && existing.email === input.email
          ? 'Email already registered'
          : 'Phone already registered',
      );
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const user = await userRepository.create({
      email: input.email,
      phone: input.phone,
      passwordHash,
      role: input.role,
    });

    // Issue email verification token (only if user provided an email)
    if (user.email) {
      await issueVerificationEmail(user.id, user.email);
    }

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user.id);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: parseRefreshExpiry(),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 86400,
      user: sanitizeUser(user),
      message: user.email
        ? 'Registration successful. Please check your email to verify your account.'
        : 'Registration successful.',
    };
  },

  async login(input: z.infer<typeof LoginSchema>) {
    const user = await userRepository.findByEmailOrPhone(input.email, input.phone);

    // Use constant-time comparison to prevent user enumeration timing attacks
    const dummyHash = '$2b$12$invalidhashfortimingnormalization000000000000000000000';
    const hashToCompare = user?.passwordHash ?? dummyHash;

    const passwordValid = await bcrypt.compare(input.password, hashToCompare);

    if (!user || !passwordValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    if (!user.isActive) {
      throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Your account has been suspended');
    }

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user.id);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: parseRefreshExpiry(),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 86400,
      user: sanitizeUser(user),
    };
  },

  async refresh(input: z.infer<typeof RefreshSchema>) {
    // Verify JWT signature and expiry
    let payload: { sub: string; type: string };
    try {
      payload = jwt.verify(input.refreshToken, env.JWT_REFRESH_SECRET) as typeof payload;
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedError('Not a refresh token');
    }

    // Check DB: token must exist and not be revoked
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: input.refreshToken },
      include: { user: true },
    });

    if (!storedToken || storedToken.revoked || storedToken.expiresAt < new Date()) {
      throw new UnauthorizedError('Refresh token is invalid or has been revoked');
    }

    if (!storedToken.user.isActive) {
      throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Your account has been suspended');
    }

    // Rotate: revoke old token, issue new pair
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    });

    const newAccessToken = signAccessToken(storedToken.user);
    const newRefreshToken = signRefreshToken(storedToken.user.id);

    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: storedToken.user.id,
        expiresAt: parseRefreshExpiry(),
      },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: 86400,
    };
  },

  async logout(refreshToken: string, userId: string) {
    // Revoke the specific refresh token
    const updated = await prisma.refreshToken.updateMany({
      where: { token: refreshToken, userId, revoked: false },
      data: { revoked: true },
    });

    if (updated.count === 0) {
      throw new UnauthorizedError('Refresh token not found or already revoked');
    }

    return { message: 'Logged out successfully' };
  },

  async logoutAll(userId: string) {
    // Revoke ALL refresh tokens for this user (useful for password change / security incidents)
    await prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
    return { message: 'All sessions terminated' };
  },

  async getProfile(userId: string) {
    const user = await userRepository.findById(userId);
    if (!user) throw new UnauthorizedError('User not found');
    return sanitizeUser(user);
  },

  /**
   * Confirm a user's email by consuming a one-time verification token.
   * Tokens are single-use and time-limited.
   */
  async verifyEmail(input: z.infer<typeof VerifyEmailSchema>) {
    const record = await prisma.emailVerificationToken.findUnique({
      where: { token: input.token },
      include: { user: true },
    });

    if (!record) throw new NotFoundError('Verification token');
    if (record.usedAt) throw new ValidationError('Token has already been used');
    if (record.expiresAt < new Date()) throw new ValidationError('Token has expired');

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { isVerified: true },
      }),
      prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { message: 'Email verified successfully' };
  },

  /**
   * Re-issue a verification email if the previous one was lost / expired.
   * Always returns success-shaped response to avoid email enumeration.
   */
  async resendVerification(input: z.infer<typeof ResendVerificationSchema>) {
    const user = await userRepository.findByEmail(input.email);
    if (user && !user.isVerified && user.email) {
      // Invalidate any existing unused tokens
      await prisma.emailVerificationToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await issueVerificationEmail(user.id, user.email);
    }
    return { message: 'If an account exists for this email, a verification link has been sent.' };
  },

  /**
   * Issue a password reset link via email. Always returns the same response
   * regardless of whether the email exists, to prevent user enumeration.
   */
  async forgotPassword(input: z.infer<typeof ForgotPasswordSchema>) {
    const user = await userRepository.findByEmail(input.email);

    if (user && user.isActive && user.email) {
      const rawToken = generateOpaqueToken(32);
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

      await prisma.passwordResetToken.create({
        data: { tokenHash, userId: user.id, expiresAt },
      });

      const resetUrl = `${env.APP_BASE_URL}/reset-password?token=${rawToken}`;
      await enqueueEmail({
        type: 'PASSWORD_RESET',
        to: user.email,
        payload: { resetUrl, expiresInMinutes: PASSWORD_RESET_TTL_MINUTES },
      });
    }

    return {
      message: 'If an account exists for this email, a password reset link has been sent.',
    };
  },

  /**
   * Consume a password reset token and set a new password.
   * Also revokes ALL refresh tokens for the user — every existing session must re-login.
   */
  async resetPassword(input: z.infer<typeof ResetPasswordSchema>) {
    const tokenHash = hashToken(input.token);
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record) throw new NotFoundError('Reset token');
    if (record.usedAt) throw new ValidationError('Token has already been used');
    if (record.expiresAt < new Date()) throw new ValidationError('Token has expired');

    const newHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: newHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Security: invalidate all existing sessions
      prisma.refreshToken.updateMany({
        where: { userId: record.userId, revoked: false },
        data: { revoked: true },
      }),
    ]);

    return { message: 'Password reset successful. Please log in with your new password.' };
  },
};

/**
 * Internal helper: create a verification token row + enqueue the email.
 * Extracted because both `register` and `resendVerification` use it.
 */
async function issueVerificationEmail(userId: string, email: string): Promise<void> {
  const token = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);

  await prisma.emailVerificationToken.create({
    data: { token, userId, expiresAt },
  });

  const verifyUrl = `${env.APP_BASE_URL}/verify-email?token=${token}`;
  await enqueueEmail({
    type: 'EMAIL_VERIFICATION',
    to: email,
    payload: { verifyUrl, expiresInHours: EMAIL_VERIFICATION_TTL_HOURS },
  });
}

function sanitizeUser(user: User) {
  const { passwordHash: _pw, ...safe } = user;
  return safe;
}

import { Request, Response } from 'express';
import {
  authService,
  RegisterSchema,
  LoginSchema,
  RefreshSchema,
  VerifyEmailSchema,
  ResendVerificationSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
} from '../services/authService';
import { asyncHandler } from '../utils/asyncHandler';

export const authController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const input = RegisterSchema.parse(req.body);
    const result = await authService.register(input);
    res.status(201).json(result);
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const input = LoginSchema.parse(req.body);
    const result = await authService.login(input);
    res.json(result);
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const input = RefreshSchema.parse(req.body);
    const result = await authService.refresh(input);
    res.json(result);
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'refreshToken required' } });
      return;
    }
    const result = await authService.logout(refreshToken, req.user!.sub);
    res.json(result);
  }),

  logoutAll: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.logoutAll(req.user!.sub);
    res.json(result);
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const profile = await authService.getProfile(req.user!.sub);
    res.json({ user: profile });
  }),

  verifyEmail: asyncHandler(async (req: Request, res: Response) => {
    // Accept token from either body (POST) or query (?token=… GET link)
    const tokenSource = (req.body?.token as string | undefined) ?? (req.query.token as string | undefined);
    const input = VerifyEmailSchema.parse({ token: tokenSource });
    const result = await authService.verifyEmail(input);
    res.json(result);
  }),

  resendVerification: asyncHandler(async (req: Request, res: Response) => {
    const input = ResendVerificationSchema.parse(req.body);
    const result = await authService.resendVerification(input);
    res.json(result);
  }),

  forgotPassword: asyncHandler(async (req: Request, res: Response) => {
    const input = ForgotPasswordSchema.parse(req.body);
    const result = await authService.forgotPassword(input);
    res.json(result);
  }),

  resetPassword: asyncHandler(async (req: Request, res: Response) => {
    const input = ResetPasswordSchema.parse(req.body);
    const result = await authService.resetPassword(input);
    res.json(result);
  }),
};

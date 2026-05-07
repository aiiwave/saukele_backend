import { Router } from 'express';
import { registryController } from '../controllers/registryController';
import { authenticate, optionalAuth } from '../middleware/auth';
import { requireCouple } from '../middleware/rbac';
import { requireVerified } from '../middleware/requireVerified';

const router = Router();

// Public list — visible to everyone
router.get('/', optionalAuth, registryController.listPublic);

// Invite code access — no auth required (link sharing)
router.get('/invite/:code', registryController.getByInviteCode);

// My registries — authenticated
router.get('/mine', authenticate, registryController.listMine);

// Create — COUPLE or ADMIN only, must be verified
router.post('/', authenticate, requireVerified, requireCouple, registryController.create);

// Get by ID — optional auth (visibility enforced in service)
router.get('/:id', optionalAuth, registryController.getById);

// Update — owner only (checked in service), must be verified
router.patch('/:id', authenticate, requireVerified, requireCouple, registryController.update);

export default router;

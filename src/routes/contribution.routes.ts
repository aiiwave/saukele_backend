import { Router } from 'express';
import { contributionController } from '../controllers/contributionController';
import { authenticate } from '../middleware/auth';
import { requireCouple } from '../middleware/rbac';
import { requireVerified } from '../middleware/requireVerified';

const router = Router();

// Pool contribution — any authenticated, verified user
router.post('/pool', authenticate, requireVerified, contributionController.poolContribute);

// Advance pool state — COUPLE or ADMIN (funded → purchased → delivered)
router.post('/pool/:giftId/advance', authenticate, requireVerified, requireCouple, contributionController.advancePool);

// My contribution history
router.get('/mine', authenticate, contributionController.myContributions);

export default router;

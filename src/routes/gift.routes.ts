import { Router } from 'express';
import { giftController } from '../controllers/giftController';
import { authenticate, optionalAuth } from '../middleware/auth';
import { requireCouple } from '../middleware/rbac';

const router = Router({ mergeParams: true });

// List gifts — public if registry is public
router.get('/', optionalAuth, giftController.list);

// Add gift — COUPLE only
router.post('/', authenticate, requireCouple, giftController.add);

// Reserve (solo contribution)
router.post('/:giftId/reserve', authenticate, giftController.reserve);

// Update/delete — owner only (checked in service)
router.patch('/:giftId', authenticate, requireCouple, giftController.update);
router.delete('/:giftId', authenticate, requireCouple, giftController.delete);

export default router;

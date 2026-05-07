import { Router } from 'express';
import { kinshipController } from '../controllers/kinshipController';
import { authenticate } from '../middleware/auth';
import { requireCouple } from '../middleware/rbac';

const router = Router({ mergeParams: true });

// Get full kinship tree for a registry
router.get('/', authenticate, kinshipController.getTree);

// Get my own tier in this registry
router.get('/my-tier', authenticate, kinshipController.getMyTier);

// Add family member — COUPLE only
router.post('/', authenticate, requireCouple, kinshipController.addMember);

// Update family member tier/label
router.patch('/:memberId', authenticate, requireCouple, kinshipController.updateMember);

export default router;

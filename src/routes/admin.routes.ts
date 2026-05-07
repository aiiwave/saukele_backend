import { Router } from 'express';
import { adminController } from '../controllers/adminController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/rbac';
import { adminRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// All admin routes require ADMIN role
router.use(authenticate, requireAdmin, adminRateLimiter);

router.get('/users', adminController.listUsers);
router.patch('/users/:userId/suspend', adminController.suspendUser);
router.patch('/users/:userId/activate', adminController.activateUser);

router.patch('/registries/:registryId/expire', adminController.expireRegistry);

router.post('/exchange-rates', adminController.setExchangeRate);

router.get('/audit', adminController.getAuditLog);

// Defense demo helper — fires a test email through the queue/worker pipeline
router.post('/test-email', adminController.testEmail);

export default router;

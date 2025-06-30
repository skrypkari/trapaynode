import { Router } from 'express';
import { AuthController } from '../controllers/authController';
import { validate, loginSchema } from '../middleware/validation';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();
const authController = new AuthController();

// Public routes
router.post('/login', validate(loginSchema), authController.login);

// Protected routes
router.get('/me', authenticateToken, authController.me);
router.post('/logout', authenticateToken, authController.logout);

// Admin only routes
router.get('/blacklist-stats', authenticateToken, requireAdmin, authController.getBlacklistStats);

export default router;
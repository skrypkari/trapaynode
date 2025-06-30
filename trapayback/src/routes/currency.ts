import { Router } from 'express';
import { CurrencyController } from '../controllers/currencyController';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();
const currencyController = new CurrencyController();

// Public routes
router.get('/rates', currencyController.getRates);
router.post('/convert', currencyController.convertCurrency);

// Admin only routes
router.get('/status', authenticateToken, requireAdmin, currencyController.getStatus);
router.post('/update', authenticateToken, requireAdmin, currencyController.updateRates);

export default router;
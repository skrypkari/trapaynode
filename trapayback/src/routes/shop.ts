import { Router } from 'express';
import { ShopController } from '../controllers/shopController';
import { GatewayController } from '../controllers/gatewayController';
import { validate, updateShopProfileSchema, createPaymentSchema, updatePaymentSchema, updateWalletsSchema } from '../middleware/validation';
import { authenticateToken, requireShop } from '../middleware/auth';

const router = Router();
const shopController = new ShopController();
const gatewayController = new GatewayController();

// All routes require shop authentication
router.use(authenticateToken, requireShop);

// Shop profile routes
router.get('/profile', shopController.getProfile);
router.put('/profile', validate(updateShopProfileSchema), shopController.updateProfile);

// Wallets route
router.put('/wallets', validate(updateWalletsSchema), shopController.updateWallets);

// Gateways route
router.get('/gateways', gatewayController.getAvailableGateways);

// Webhook test route
router.post('/webhook/test', shopController.testWebhook);

// Payment management routes
router.post('/payments', validate(createPaymentSchema), shopController.createPayment);
router.get('/payments', shopController.getPayments);
router.get('/payments/:id', shopController.getPaymentById);
router.put('/payments/:id', validate(updatePaymentSchema), shopController.updatePayment);
router.delete('/payments/:id', shopController.deletePayment);

// Payout management routes - IMPORTANT: specific routes must come before parameterized routes
router.get('/payouts/stats', shopController.getShopPayoutStats); // New shop-specific stats endpoint
router.get('/payout-statistics', shopController.getPayoutStatistics);
router.get('/payouts', shopController.getPayouts);
router.get('/payouts/:id', shopController.getPayoutById);

// Webhook logs routes
router.get('/webhook-logs', shopController.getWebhookLogs);

// Statistics routes
router.get('/statistics', shopController.getStatistics);

export default router;
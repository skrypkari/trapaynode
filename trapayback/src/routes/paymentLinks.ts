import { Router } from 'express';
import { PaymentLinkController } from '../controllers/paymentLinkController';
import { validate, createPaymentLinkSchema, updatePaymentLinkSchema, initiatePaymentFromLinkSchema } from '../middleware/validation';
import { authenticateToken, requireShop } from '../middleware/auth';

const router = Router();
const paymentLinkController = new PaymentLinkController();

// Protected routes (require shop authentication) - MAIN ROUTES
router.use(authenticateToken, requireShop);

// Payment link management routes
router.post('/', validate(createPaymentLinkSchema), paymentLinkController.createPaymentLink);
router.get('/', paymentLinkController.getPaymentLinks);
router.get('/statistics', paymentLinkController.getStatistics);
router.get('/:id', paymentLinkController.getPaymentLinkById);
router.put('/:id', validate(updatePaymentLinkSchema), paymentLinkController.updatePaymentLink);
router.delete('/:id', paymentLinkController.deletePaymentLink);

export default router;
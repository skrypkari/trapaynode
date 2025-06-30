import { Router } from 'express';
import { PaymentLinkController } from '../controllers/paymentLinkController';
import { validate, initiatePaymentFromLinkSchema } from '../middleware/validation';

const router = Router();
const paymentLinkController = new PaymentLinkController();

// Public routes (no authentication required)
router.get('/:id', paymentLinkController.getPublicPaymentLink);
router.post('/:id/pay', validate(initiatePaymentFromLinkSchema), paymentLinkController.initiatePaymentFromLink);

export default router;
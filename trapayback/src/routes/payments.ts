import { Router } from 'express';
import { PaymentController } from '../controllers/paymentController';
import { validate, createPublicPaymentSchema } from '../middleware/validation';

const router = Router();
const paymentController = new PaymentController();

// Public payment creation route (requires public_key instead of auth)
router.post('/create', validate(createPublicPaymentSchema), paymentController.createPublicPayment);

// Public payment status route
router.get('/:id/status', paymentController.getPaymentStatus);

// New route to get payment by ID (either our ID or shop's order ID)
router.get('/:id', paymentController.getPaymentById);

export default router;
import { Router } from 'express';
import { GatewayController } from '../controllers/gatewayController';

const router = Router();
const gatewayController = new GatewayController();

// Public routes for gateway information
router.get('/all', gatewayController.getAllGateways);
router.get('/active', gatewayController.getActiveGateways);

export default router;
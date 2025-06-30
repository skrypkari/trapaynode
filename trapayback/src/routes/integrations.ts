import { Router } from 'express';
import { IntegrationsController } from '../controllers/integrationsController';
import { validate, updateWebhookSettingsSchema } from '../middleware/validation';
import { authenticateToken, requireShop } from '../middleware/auth';

const router = Router();
const integrationsController = new IntegrationsController();

// All routes require shop authentication
router.use(authenticateToken, requireShop);

// Integrations routes
router.get('/', integrationsController.getIntegrations);
router.put('/webhook', validate(updateWebhookSettingsSchema), integrationsController.updateWebhookSettings);

export default router;
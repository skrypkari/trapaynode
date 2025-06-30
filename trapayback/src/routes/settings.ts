import { Router } from 'express';
import { SettingsController } from '../controllers/settingsController';
import { 
  validate, 
  changePasswordSchema, 
  updateNotificationsSchema, 
  updateTelegramSettingsSchema,
  updateWebhookSettingsSchema,
  deleteAccountSchema 
} from '../middleware/validation';
import { authenticateToken, requireShop } from '../middleware/auth';

const router = Router();
const settingsController = new SettingsController();

// All routes require shop authentication
router.use(authenticateToken, requireShop);

// Settings routes
router.get('/', settingsController.getSettings);
router.post('/password', validate(changePasswordSchema), settingsController.changePassword);
router.put('/notifications', validate(updateNotificationsSchema), settingsController.updateNotifications);
router.put('/telegram', validate(updateTelegramSettingsSchema), settingsController.updateTelegramSettings);
router.put('/webhook', validate(updateWebhookSettingsSchema), settingsController.updateWebhookSettings);
router.post('/api-keys/revoke', settingsController.revokeApiKeys);
router.post('/account/delete', validate(deleteAccountSchema), settingsController.deleteAccount);

export default router;
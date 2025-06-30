import { Router } from 'express';
import { TelegramController } from '../controllers/telegramController';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();
const telegramController = new TelegramController();

// All routes require admin authentication
router.use(authenticateToken, requireAdmin);

// Telegram bot management routes
router.get('/status', telegramController.getBotStatus);
router.get('/users', telegramController.getTelegramUsers);
router.post('/broadcast', telegramController.sendBroadcast);
router.delete('/users/:telegramId', telegramController.disconnectUser);
router.post('/test', telegramController.sendTestNotification);

export default router;
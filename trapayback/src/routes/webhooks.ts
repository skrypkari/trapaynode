import { Router } from 'express';
import multer from 'multer';
import { WebhookController } from '../controllers/webhookController';

const router = Router();
const webhookController = new WebhookController();

const upload = multer();

router.options('*', (req, res) => {
  console.log(`📋 Webhook OPTIONS request to: ${req.originalUrl}`);
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, User-Agent');
  res.status(200).json({
    success: true,
    message: 'Webhook CORS preflight successful',
    endpoint: req.originalUrl,
  });
});

router.post('/plisio', upload.none(), webhookController.handlePlisioWebhook);

router.post('/gateway/plisio', upload.none(), webhookController.handlePlisioGatewayWebhook);

router.post('/gateway/rapyd', webhookController.handleRapydWebhook);

router.post('/gateway/noda', webhookController.handleNodaWebhook);

router.post('/gateway/cointopay', webhookController.handleCoinToPayWebhook);

// KLYME webhook endpoints
router.post('/gateway/klyme', webhookController.handleKlymeWebhook);

// Alternative webhook endpoints with tesoft.uk format
router.post('/gateways/plisio/webhook', upload.none(), webhookController.handlePlisioGatewayWebhook);
router.post('/gateways/rapyd/webhook', webhookController.handleRapydWebhook);
router.post('/gateways/noda/webhook', webhookController.handleNodaWebhook);
router.post('/gateways/cointopay/webhook', webhookController.handleCoinToPayWebhook);
router.post('/gateways/klyme/webhook', webhookController.handleKlymeWebhook);

export default router;
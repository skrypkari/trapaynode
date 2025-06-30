import { Router } from 'express';
import authRoutes from './auth';
import userRoutes from './users';
import shopRoutes from './shop';
import settingsRoutes from './settings';
import integrationsRoutes from './integrations';
import paymentRoutes from './payments';
import paymentLinkRoutes from './paymentLinks';
import publicPaymentLinkRoutes from './publicPaymentLinks';
import webhookRoutes from './webhooks';
import telegramRoutes from './telegram';
import currencyRoutes from './currency';
import gatewayRoutes from './gateways';
import adminRoutes from './admin';

const router = Router();

// ✅ ДОБАВЛЕНО: Глобальный обработчик OPTIONS для API роутов
router.options('*', (req, res) => {
  console.log(`📋 API OPTIONS request to: ${req.originalUrl}`);
  res.header('Access-Control-Allow-Origin', req.get('Origin') || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(200).json({
    success: true,
    message: 'API CORS preflight successful',
    endpoint: req.originalUrl,
    timestamp: new Date().toISOString(),
  });
});

// Public routes MUST come first (before protected routes)
router.use('/public/payment-links', publicPaymentLinkRoutes);

// API routes
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/users', userRoutes);
router.use('/shop', shopRoutes);
router.use('/shop/settings', settingsRoutes);
router.use('/shop/integrations', integrationsRoutes);
router.use('/payments', paymentRoutes);
router.use('/payment-links', paymentLinkRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/telegram', telegramRoutes);
router.use('/currency', currencyRoutes);
router.use('/gateways', gatewayRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Payment system API is running',
    timestamp: new Date().toISOString(),
  });
});

export default router;
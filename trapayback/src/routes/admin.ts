import { Router } from 'express';
import { AdminController } from '../controllers/adminController';
import { validate, createUserSchema, updateUserSchema, createPayoutSchema } from '../middleware/validation';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { loggerService } from '../services/loggerService';
import { coinToPayStatusService } from '../services/coinToPayStatusService';
import { domainMonitoringService } from '../services/domainMonitoringService'; // ✅ ДОБАВЛЕНО

const router = Router();
const adminController = new AdminController();

// All routes require admin authentication
router.use(authenticateToken, requireAdmin);

// Admin authentication check
router.get('/auth', adminController.checkAuth);

// Admin statistics
router.get('/statistics', adminController.getStatistics);

// ✅ ДОБАВЛЕНО: Merchant statistics with filters
router.get('/merchant-statistics', adminController.getMerchantStatistics);

// Payout statistics and merchants
router.get('/payout/stats', adminController.getPayoutStats);
router.get('/payout/merchants', adminController.getMerchantsAwaitingPayout);

// Payout management routes
router.post('/payout', validate(createPayoutSchema), adminController.createPayout);
router.get('/payouts', adminController.getPayouts);
router.get('/payouts/:id', adminController.getPayoutById);
router.delete('/payouts/:id', adminController.deletePayout);

// Payment management routes
router.get('/payments', adminController.getPayments);
router.get('/payments/:id', adminController.getPaymentById);
router.put('/payments/:id', adminController.updatePayment);

// User management routes
router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUserById);
router.post('/users', validate(createUserSchema), adminController.createUser);
router.put('/users/:id', validate(updateUserSchema), adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);

// User status management routes
router.post('/users/:id/suspend', adminController.suspendUser);
router.post('/users/:id/activate', adminController.activateUser);

// Logging routes
router.get('/logs/stats', (req, res) => {
  try {
    const stats = loggerService.getLogStats();
    res.json({
      success: true,
      result: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get log statistics',
    });
  }
});

router.post('/logs/clean', (req, res) => {
  try {
    const { daysToKeep = 30 } = req.body;
    loggerService.cleanOldLogs(daysToKeep);
    res.json({
      success: true,
      message: `Old logs cleaned (kept last ${daysToKeep} days)`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to clean old logs',
    });
  }
});

// CoinToPay status check routes
router.post('/cointopay/check/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    console.log(`🔍 [ADMIN] Manual CoinToPay check requested for payment: ${paymentId}`);
    
    await coinToPayStatusService.checkPaymentById(paymentId);
    
    res.json({
      success: true,
      message: 'CoinToPay payment status checked successfully',
    });
  } catch (error) {
    console.error(`❌ [ADMIN] Manual CoinToPay check failed for payment ${req.params.paymentId}:`, error);
    
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to check CoinToPay payment status',
    });
  }
});

router.get('/cointopay/stats', (req, res) => {
  try {
    const stats = coinToPayStatusService.getServiceStats();
    
    res.json({
      success: true,
      result: {
        ...stats,
        description: 'CoinToPay automatic status checking service',
        statusMapping: {
          'Paid': 'PAID',
          'Awaiting Fiat': 'PENDING',
          'waiting': 'PENDING',
          'expired': 'EXPIRED',
          'failed': 'FAILED',
        },
        autoExpiryNote: `Payments automatically expire after ${stats.expiryDays} days if not paid`,
        individualTimersNote: 'Each new payment gets individual timers: 1min, 2min, 7min, 12min, then hourly',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get CoinToPay service statistics',
    });
  }
});

// ✅ ДОБАВЛЕНО: Новый endpoint для получения информации о конкретном платеже
router.get('/cointopay/payment/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    // Получаем информацию о таймерах
    const timerInfo = coinToPayStatusService.getPaymentTimerInfo(paymentId);
    
    // Получаем информацию о платеже из базы данных
    const prisma = (await import('../config/database')).default;
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        gateway: true,
        gatewayPaymentId: true,
        status: true,
        amount: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
        shopId: true,
        shop: {
          select: {
            name: true,
            username: true,
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    res.json({
      success: true,
      result: {
        payment: {
          id: payment.id,
          gateway: payment.gateway,
          gatewayPaymentId: payment.gatewayPaymentId,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
          shop: payment.shop,
        },
        timers: timerInfo,
        isCoinToPay: payment.gateway === 'cointopay',
        ageInMinutes: Math.floor((Date.now() - payment.createdAt.getTime()) / (1000 * 60)),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to get payment information',
    });
  }
});

// ✅ ДОБАВЛЕНО: Domain monitoring routes
router.get('/domain-monitoring/stats', (req, res) => {
  try {
    const stats = domainMonitoringService.getMonitoringStats();
    
    res.json({
      success: true,
      result: {
        ...stats,
        description: 'Domain monitoring service for amaterasy884.icu',
        behavior: 'Server crashes if domain is not responding after consecutive failures',
        encoding: 'Requests are made with base64 encoded URLs',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get domain monitoring statistics',
    });
  }
});

router.post('/domain-monitoring/check', async (req, res) => {
  try {
    const result = await domainMonitoringService.manualCheck();
    
    res.json({
      success: true,
      result: {
        domainAvailable: result,
        message: result ? 'Domain is responding correctly' : 'Domain check failed',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to perform manual domain check',
    });
  }
});

export default router;
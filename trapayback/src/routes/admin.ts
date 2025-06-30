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
    await coinToPayStatusService.checkPaymentById(paymentId);
    
    res.json({
      success: true,
      message: 'CoinToPay payment status checked successfully',
    });
  } catch (error) {
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
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get CoinToPay service statistics',
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
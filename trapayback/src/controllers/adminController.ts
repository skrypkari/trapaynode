import { Request, Response, NextFunction } from 'express';
import { AdminService } from '../services/adminService';
import { PaymentLinkService } from '../services/paymentLinkService'; // ✅ ДОБАВЛЕНО
import { telegramBotService } from '../services/telegramBotService';
import { UpdateUserRequest } from '../types/user';
import { MerchantsAwaitingPayoutFilters, CreatePayoutRequest, PayoutFilters } from '../types/admin';

export class AdminController {
  private adminService: AdminService;
  private paymentLinkService: PaymentLinkService; // ✅ ДОБАВЛЕНО

  constructor() {
    this.adminService = new AdminService();
    this.paymentLinkService = new PaymentLinkService(); // ✅ ДОБАВЛЕНО
  }

  // GET /api/admin/auth - Check if user is admin
  checkAuth = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      
      // If we reach here, the user is authenticated and is an admin
      // (thanks to requireAdmin middleware)
      res.json({
        success: true,
        message: 'Admin access confirmed',
        user: {
          id: user?.id,
          username: user?.username,
          role: user?.role,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/admin/statistics - Get system statistics
  getStatistics = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { period = '30d' } = req.query;
      const statistics = await this.adminService.getSystemStatistics(period as string);
      
      res.json({
        success: true,
        result: statistics,
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/admin/payout/stats - Get payout statistics
  getPayoutStats = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await this.adminService.getPayoutStats();
      
      res.json({
        success: true,
        result: stats,
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/admin/payout/merchants - Get merchants awaiting payout
  getMerchantsAwaitingPayout = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { 
        page = 1, 
        limit = 20, 
        minAmount,
        search
      } = req.query;

      const filters: MerchantsAwaitingPayoutFilters = {
        page: Number(page),
        limit: Number(limit),
        minAmount: minAmount ? Number(minAmount) : undefined,
        search: search as string,
      };

      const result = await this.adminService.getMerchantsAwaitingPayout(filters);
      
      res.json({
        success: true,
        merchants: result.merchants,
        pagination: result.pagination,
        summary: result.summary,
      });
    } catch (error) {
      next(error);
    }
  };

  // POST /api/admin/payout - Create new payout
  createPayout = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payoutData: CreatePayoutRequest = req.body;
      const result = await this.adminService.createPayout(payoutData);
      
      res.status(201).json({
        success: true,
        message: 'Payout created successfully',
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/admin/payouts - Get all payouts with pagination and filters
  getPayouts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { 
        page = 1, 
        limit = 20, 
        shopId,
        network,
        dateFrom,
        dateTo,
        search
      } = req.query;

      const filters: PayoutFilters = {
        page: Number(page),
        limit: Number(limit),
        shopId: shopId as string,
        network: network as string,
        dateFrom: dateFrom as string,
        dateTo: dateTo as string,
        search: search as string,
      };

      const result = await this.adminService.getAllPayouts(filters);
      
      res.json({
        success: true,
        payouts: result.payouts,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/admin/payouts/:id - Get payout by ID
  getPayoutById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const payout = await this.adminService.getPayoutById(id);
      
      if (!payout) {
        return res.status(404).json({
          success: false,
          message: 'Payout not found',
        });
      }

      res.json({
        success: true,
        result: payout,
      });
    } catch (error) {
      next(error);
    }
  };

  // DELETE /api/admin/payouts/:id - Delete payout
  deletePayout = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      await this.adminService.deletePayout(id);
      
      res.json({
        success: true,
        message: 'Payout deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/admin/payments - Get all payments with pagination and filters
  getPayments = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { 
        page = 1, 
        limit = 20, 
        status,
        gateway,
        shopId,
        dateFrom,
        dateTo,
        search
      } = req.query;

      const filters = {
        page: Number(page),
        limit: Number(limit),
        status: status as string,
        gateway: gateway as string,
        shopId: shopId as string,
        dateFrom: dateFrom as string,
        dateTo: dateTo as string,
        search: search as string,
      };

      const result = await this.adminService.getAllPayments(filters);
      
      res.json({
        success: true,
        payments: result.payments,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/admin/payments/:id - Get payment by ID
  getPaymentById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const payment = await this.adminService.getPaymentById(id);
      
      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
        });
      }

      res.json({
        success: true,
        result: payment,
      });
    } catch (error) {
      next(error);
    }
  };

  // ✅ ОБНОВЛЕНО: PUT /api/admin/payments/:id - Update payment status without mentioning admin
  updatePayment = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { status, notes, chargebackAmount } = req.body;
      
      // Получаем платеж до обновления для сравнения статуса
      const paymentBefore = await this.adminService.getPaymentById(id);
      
      if (!paymentBefore) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
        });
      }

      const result = await this.adminService.updatePaymentStatus(id, status, notes, chargebackAmount);
      
      // ✅ ДОБАВЛЕНО: Обрабатываем payment link если статус изменился на PAID
      if (paymentBefore.status !== status && status.toUpperCase() === 'PAID') {
        console.log(`📈 Admin changed payment ${id} to PAID, updating payment link counter`);
        
        try {
          await this.paymentLinkService.handleSuccessfulPayment(id);
          console.log(`✅ Payment link counter updated for payment ${id}`);
        } catch (linkError) {
          console.error('Failed to update payment link counter:', linkError);
          // Не прерываем выполнение, если обновление счетчика не удалось
        }
      }

      // ✅ ОБНОВЛЕНО: Отправляем Telegram уведомление БЕЗ упоминания админа
      if (paymentBefore.status !== status) {
        console.log(`📱 Payment ${id} status changed from ${paymentBefore.status} to ${status}, sending Telegram notification`);
        
        try {
          // Определяем тип уведомления для Telegram
          let telegramStatus: 'paid' | 'failed' | 'expired' | 'refund' | 'chargeback' | 'processing';
          
          switch (status.toUpperCase()) {
            case 'PAID':
              telegramStatus = 'paid';
              break;
            case 'PROCESSING':
              telegramStatus = 'processing';
              break;
            case 'FAILED':
              telegramStatus = 'failed';
              break;
            case 'EXPIRED':
              telegramStatus = 'expired';
              break;
            case 'REFUND':
              telegramStatus = 'refund';
              break;
            case 'CHARGEBACK':
              telegramStatus = 'chargeback';
              break;
            default:
              // Для PENDING и других статусов не отправляем уведомление
              console.log(`📱 Skipping Telegram notification for status change to: ${status}`);
              break;
          }

          // Отправляем уведомление только если статус определен
          if (telegramStatus!) {
            // ✅ ОБНОВЛЕНО: Подготавливаем данные платежа БЕЗ упоминания админа
            const paymentForNotification = {
              ...result,
              shopId: paymentBefore.shopId,
              gateway: paymentBefore.gateway,
              createdAt: paymentBefore.createdAt,
              // ✅ УБРАНО: Не добавляем информацию о том, что изменение сделано админом
              chargebackAmount: chargebackAmount,
            };

            await telegramBotService.sendPaymentNotification(
              paymentBefore.shopId, 
              paymentForNotification, 
              //@ts-ignore
              telegramStatus
            );

            console.log(`✅ Telegram notification sent for status change: ${paymentBefore.status} -> ${status}`);
          }
        } catch (telegramError) {
          console.error('Failed to send Telegram notification for status change:', telegramError);
          // Не прерываем выполнение, если уведомление не отправилось
        }
      }
      
      res.json({
        success: true,
        message: 'Payment updated successfully',
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // PUT /api/admin/users/:id - Update user by admin
  updateUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const updateData: UpdateUserRequest = req.body;
      
      const result = await this.adminService.updateUser(id, updateData);
      
      res.json({
        success: true,
        message: 'User updated successfully',
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // POST /api/admin/users/:id/suspend - Suspend user
  suspendUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      
      const result = await this.adminService.suspendUser(id);
      
      res.json({
        success: true,
        message: 'User suspended successfully',
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // POST /api/admin/users/:id/activate - Activate user (unsuspend)
  activateUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      
      const result = await this.adminService.activateUser(id);
      
      res.json({
        success: true,
        message: 'User activated successfully',
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/admin/users - Get all users with pagination and filters
  getUsers = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { 
        page = 1, 
        limit = 20, 
        status 
      } = req.query;

      const filters = {
        page: Number(page),
        limit: Number(limit),
        status: status as string,
      };

      const result = await this.adminService.getAllUsers(filters);
      
      res.json({
        success: true,
        users: result.users,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/admin/users/:id - Get user by ID
  getUserById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const user = await this.adminService.getUserById(id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      res.json({
        success: true,
        result: user,
      });
    } catch (error) {
      next(error);
    }
  };

  // POST /api/admin/users - Create new user
  createUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userData = req.body;
      const result = await this.adminService.createUser(userData);
      
      res.status(201).json({
        success: true,
        message: 'User created successfully',
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // DELETE /api/admin/users/:id - Delete user
  deleteUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      await this.adminService.deleteUser(id);
      
      res.json({
        success: true,
        message: 'User deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}
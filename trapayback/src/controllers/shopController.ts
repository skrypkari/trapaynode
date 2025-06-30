import { Request, Response, NextFunction } from 'express';
import { ShopService } from '../services/shopService';
import { GatewayController } from '../controllers/gatewayController';
import { CreatePaymentRequest, UpdatePaymentRequest } from '../types/payment';
import { UpdateWalletsRequest } from '../types/shop';

export class ShopController {
  private shopService: ShopService;

  constructor() {
    this.shopService = new ShopService();
  }

  // Shop profile management
  getProfile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const profile = await this.shopService.getShopProfile(shopId);
      
      res.json({
        success: true,
        result: profile,
      });
    } catch (error) {
      next(error);
    }
  };

  updateProfile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const result = await this.shopService.updateShopProfile(shopId, req.body);
      
      res.json({
        success: true,
        message: 'Profile updated successfully',
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // New method to update wallets
  updateWallets = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const walletData: UpdateWalletsRequest = req.body;
      await this.shopService.updateWallets(shopId, walletData);
      
      res.json({
        success: true,
        message: 'Wallets updated successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  // New method to test webhook
  testWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const result = await this.shopService.testWebhook(shopId);
      
      res.json({
        success: true,
        message: 'Test webhook sent successfully',
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // Payment management
  createPayment = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const paymentData: CreatePaymentRequest = {
        ...req.body,
        shopId,
      };

      const result = await this.shopService.createPayment(paymentData);
      
      res.status(201).json({
        success: true,
        message: 'Payment created successfully',
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  getPayments = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const { page = 1, limit = 20, status, gateway } = req.query;
      
      const result = await this.shopService.getPayments(shopId, {
        page: Number(page),
        limit: Number(limit),
        status: status as string,
        gateway: gateway as string,
      });
      
      res.json({
        success: true,
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  getPaymentById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      const { id } = req.params;
      
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const payment = await this.shopService.getPaymentById(shopId, id);
      
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

  updatePayment = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      const { id } = req.params;
      
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const updateData: UpdatePaymentRequest = req.body;
      const result = await this.shopService.updatePayment(shopId, id, updateData);
      
      res.json({
        success: true,
        message: 'Payment updated successfully',
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  deletePayment = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      const { id } = req.params;
      
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      await this.shopService.deletePayment(shopId, id);
      
      res.json({
        success: true,
        message: 'Payment deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  // Payout management routes - Updated for shop payout stats
  getPayouts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const { page = 1, limit = 20, status, method, dateFrom, dateTo } = req.query;
      
      const result = await this.shopService.getPayouts(shopId, {
        page: Number(page),
        limit: Number(limit),
        status: status as string,
        method: method as string,
        dateFrom: dateFrom as string,
        dateTo: dateTo as string,
      });
      
      res.json({
        success: true,
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  getPayoutById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      const { id } = req.params;
      
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const payout = await this.shopService.getPayoutById(shopId, id);
      
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

  getPayoutStatistics = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const { period = '30d' } = req.query;
      const stats = await this.shopService.getPayoutStatistics(shopId, period as string);
      
      res.json({
        success: true,
        result: stats,
      });
    } catch (error) {
      next(error);
    }
  };

  // New method for shop payout stats with specific structure
  getShopPayoutStats = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const stats = await this.shopService.getShopPayoutStats(shopId);
      
      res.json({
        success: true,
        result: stats,
      });
    } catch (error) {
      next(error);
    }
  };

  // Legacy method for backward compatibility
  getPayoutStats = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const stats = await this.shopService.getPayoutStats(shopId);
      
      res.json({
        success: true,
        result: stats,
      });
    } catch (error) {
      next(error);
    }
  };

  // Webhook logs
  getWebhookLogs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const { page = 1, limit = 20, paymentId } = req.query;
      
      const result = await this.shopService.getWebhookLogs(shopId, {
        page: Number(page),
        limit: Number(limit),
        paymentId: paymentId as string,
      });
      
      res.json({
        success: true,
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // Statistics
  getStatistics = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const { period = '30d' } = req.query;
      const stats = await this.shopService.getStatistics(shopId, period as string);
      
      res.json({
        success: true,
        result: stats,
      });
    } catch (error) {
      next(error);
    }
  };
}
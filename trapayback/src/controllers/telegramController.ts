import { Request, Response, NextFunction } from 'express';
import { telegramBotService } from '../services/telegramBotService';
import prisma from '../config/database';

export class TelegramController {
  // GET /api/telegram/status - Get bot status and statistics
  getBotStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const botInfo = telegramBotService.getBotInfo();
      
      // Get statistics
      const totalUsers = await prisma.telegramUser.count();
      const verifiedUsers = await prisma.telegramUser.count({
        where: { isVerified: true },
      });
      const activeShops = await prisma.telegramUser.groupBy({
        by: ['shopId'],
        where: {
          isVerified: true,
          shopId: { not: null },
        },
        _count: { shopId: true },
      });

      res.json({
        success: true,
        result: {
          bot: {
            isActive: botInfo.isActive,
            username: botInfo.username,
          },
          statistics: {
            totalUsers,
            verifiedUsers,
            unverifiedUsers: totalUsers - verifiedUsers,
            connectedShops: activeShops.length,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/telegram/users - Get all Telegram users (admin only)
  getTelegramUsers = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page = 1, limit = 20, verified } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const where: any = {};
      if (verified !== undefined) {
        where.isVerified = verified === 'true';
      }

      const [users, total] = await Promise.all([
        prisma.telegramUser.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy: { createdAt: 'desc' },
          include: {
            shop: {
              select: {
                id: true,
                name: true,
                username: true,
              },
            },
          },
        }),
        prisma.telegramUser.count({ where }),
      ]);

      res.json({
        success: true,
        users: users.map(user => ({
          id: user.id,
          telegramId: user.telegramId,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          isVerified: user.isVerified,
          shop: user.shop,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  // POST /api/telegram/broadcast - Send broadcast message to all verified users (admin only)
  sendBroadcast = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { message, shopId } = req.body;

      if (!message) {
        return res.status(400).json({
          success: false,
          message: 'Message is required',
        });
      }

      if (shopId) {
        // Send to specific shop
        await telegramBotService.sendShopNotification(shopId, message, { parse_mode: 'Markdown' });
      } else {
        // Send to all verified users
        const verifiedUsers = await prisma.telegramUser.findMany({
          where: { isVerified: true },
          select: { shopId: true },
        });

        const uniqueShopIds = [...new Set(verifiedUsers.map(u => u.shopId).filter(Boolean))];
        
        for (const shopId of uniqueShopIds) {
          if (shopId) {
            await telegramBotService.sendShopNotification(shopId, message, { parse_mode: 'Markdown' });
          }
        }
      }

      res.json({
        success: true,
        message: 'Broadcast message sent successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  // DELETE /api/telegram/users/:telegramId - Disconnect user (admin only)
  disconnectUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { telegramId } = req.params;

      const user = await prisma.telegramUser.findUnique({
        where: { telegramId },
        include: { shop: true },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Telegram user not found',
        });
      }

      // Disconnect user
      await prisma.telegramUser.update({
        where: { telegramId },
        data: {
          shopId: null,
          isVerified: false,
        },
      });

      res.json({
        success: true,
        message: 'User disconnected successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  // POST /api/telegram/test - Send test notification (admin only)
  sendTestNotification = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { shopId, type = 'payment', testData } = req.body;

      if (!shopId) {
        return res.status(400).json({
          success: false,
          message: 'Shop ID is required',
        });
      }

      // Check if shop exists
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { id: true, name: true },
      });

      if (!shop) {
        return res.status(404).json({
          success: false,
          message: 'Shop not found',
        });
      }

      // Send test notification based on type
      switch (type) {
        case 'payment':
          const mockPayment = {
            id: 'test_payment_123',
            amount: testData?.amount || 100,
            currency: testData?.currency || 'USD',
            productName: testData?.productName || 'Test Product',
            gateway: testData?.gateway || 'plisio',
            createdAt: new Date(),
            ...testData,
          };
          await telegramBotService.sendPaymentNotification(shopId, mockPayment, 'paid');
          break;

        case 'payout':
          const mockPayout = {
            id: 'test_payout_123',
            amount: testData?.amount || 500,
            method: testData?.method || 'bank_transfer',
            createdAt: new Date(),
            ...testData,
          };
          await telegramBotService.sendPayoutNotification(shopId, mockPayout, 'completed');
          break;

        case 'custom':
          await telegramBotService.sendCustomNotification(
            shopId,
            testData?.title || 'Test Notification',
            testData?.details || { message: 'This is a test notification' }
          );
          break;

        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid notification type. Use: payment, payout, or custom',
          });
      }

      res.json({
        success: true,
        message: `Test ${type} notification sent successfully`,
      });
    } catch (error) {
      next(error);
    }
  };
}
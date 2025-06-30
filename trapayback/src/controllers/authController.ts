import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/authService';
import { tokenBlacklistService } from '../services/tokenBlacklistService';
import { telegramBotService } from '../services/telegramBotService'; // ✅ ДОБАВЛЕНО
import { LoginRequest } from '../types/auth';

export class AuthController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const credentials: LoginRequest = req.body;
      
      // ✅ ДОБАВЛЕНО: Получаем IP адрес и User-Agent для уведомления
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';
      
      let loginSuccess = false;
      let shopId: string | null = null;
      
      try {
        const result = await this.authService.login(credentials);
        loginSuccess = true;
        
        // ✅ ДОБАВЛЕНО: Получаем shopId для отправки уведомления
        if (result.role === 'shop' && result.user?.id) {
          shopId = result.user.id;
        }

        // ✅ ДОБАВЛЕНО: Отправляем уведомление об успешном входе
        if (shopId) {
          await telegramBotService.sendLoginNotification(shopId, {
            username: credentials.username,
            ipAddress,
            userAgent,
            timestamp: new Date(),
            success: true,
          });
        }

        res.json({
          success: true,
          result: result,
        });
      } catch (authError) {
        // ✅ ДОБАВЛЕНО: Попытаемся найти магазин для отправки уведомления о неудачном входе
        try {
          const prisma = (await import('../config/database')).default;
          const shop = await prisma.shop.findUnique({
            where: { username: credentials.username },
            select: { id: true },
          });

          if (shop) {
            await telegramBotService.sendLoginNotification(shop.id, {
              username: credentials.username,
              ipAddress,
              userAgent,
              timestamp: new Date(),
              success: false,
            });
          }
        } catch (notificationError) {
          console.error('Failed to send failed login notification:', notificationError);
        }

        // Пробрасываем оригинальную ошибку аутентификации
        throw authError;
      }
    } catch (error) {
      next(error);
    }
  };

  me = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      
      res.json({
        success: true,
        result: {
          id: user?.id,
          username: user?.username,
          role: user?.role,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.token;
      const user = req.user;

      if (token && user?.exp) {
        // Add token to blacklist with its expiration time
        tokenBlacklistService.blacklistToken(token, user.exp);
      }

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  // Admin endpoint to get blacklist statistics
  getBlacklistStats = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = tokenBlacklistService.getStats();
      
      res.json({
        success: true,
        result: stats,
      });
    } catch (error) {
      next(error);
    }
  };
}
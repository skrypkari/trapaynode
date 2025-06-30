import { Request, Response, NextFunction } from 'express';
import { SettingsService } from '../services/settingsService';
import { 
  ChangePasswordRequest, 
  UpdateNotificationsRequest, 
  UpdateTelegramSettingsRequest,
  UpdateWebhookSettingsRequest,
  DeleteAccountRequest 
} from '../types/settings';

export class SettingsController {
  private settingsService: SettingsService;

  constructor() {
    this.settingsService = new SettingsService();
  }

  getSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const settings = await this.settingsService.getShopSettings(shopId);
      
      res.json({
        success: true,
        message: 'Shop settings retrieved successfully',
        data: settings,
      });
    } catch (error) {
      next(error);
    }
  };

  changePassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const passwordData: ChangePasswordRequest = req.body;
      await this.settingsService.changePassword(shopId, passwordData);
      
      res.json({
        success: true,
        message: 'Password updated successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  updateNotifications = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const notificationData: UpdateNotificationsRequest = req.body;
      await this.settingsService.updateNotifications(shopId, notificationData);
      
      res.json({
        success: true,
        message: 'Notification preferences updated successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  updateTelegramSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const telegramData: UpdateTelegramSettingsRequest = req.body;
      await this.settingsService.updateTelegramSettings(shopId, telegramData);
      
      res.json({
        success: true,
        message: 'Telegram bot settings updated successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  updateWebhookSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const webhookData: UpdateWebhookSettingsRequest = req.body;
      await this.settingsService.updateWebhookSettings(shopId, webhookData);
      
      res.json({
        success: true,
        message: 'Webhook settings updated successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  revokeApiKeys = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      await this.settingsService.revokeAllApiKeys(shopId);
      
      res.json({
        success: true,
        message: 'All API keys revoked successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  deleteAccount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const deleteData: DeleteAccountRequest = req.body;
      await this.settingsService.deleteAccount(shopId, deleteData);
      
      res.json({
        success: true,
        message: 'Account deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}
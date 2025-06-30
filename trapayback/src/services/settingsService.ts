import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../config/database';
import { 
  ShopSettingsResponse, 
  ChangePasswordRequest, 
  UpdateNotificationsRequest, 
  UpdateTelegramSettingsRequest,
  UpdateWebhookSettingsRequest,
  DeleteAccountRequest 
} from '../types/settings';

export class SettingsService {
  private maskApiKey(apiKey: string): string {
    if (!apiKey) return '';
    if (apiKey.length <= 8) return apiKey;
    
    const prefix = apiKey.substring(0, 8);
    const masked = '*'.repeat(Math.max(0, apiKey.length - 8));
    return prefix + masked;
  }

  // ✅ ДОБАВЛЕНО: Helper method to handle JSON arrays for MySQL
  private parseWebhookEvents(webhookEvents: any): string[] {
    if (!webhookEvents) return [];
    
    // If it's already an array, return it
    if (Array.isArray(webhookEvents)) {
      return webhookEvents;
    }
    
    // If it's a JSON string, parse it
    if (typeof webhookEvents === 'string') {
      try {
        const parsed = JSON.parse(webhookEvents);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    
    return [];
  }

  async getShopSettings(shopId: string): Promise<ShopSettingsResponse> {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      include: {
        settings: true,
      },
    });

    if (!shop) {
      throw new Error('Shop not found');
    }

    // Create default settings if they don't exist
    let settings = shop.settings;
    if (!settings) {
      settings = await prisma.shopSettings.create({
        data: {
          shopId: shop.id,
        },
      });
    }

    return {
      fullName: shop.name,
      brand: shop.name, // Using name as brand for now
      merchantUrl: shop.shopUrl,
      telegramUsername: shop.telegram,
      telegramBotApiKey: settings.telegramBotApiKey ? this.maskApiKey(settings.telegramBotApiKey) : null,
      telegramChatId: settings.telegramChatId,
      webhookUrl: settings.webhookUrl, // Get from settings instead of shop
      webhookEvents: this.parseWebhookEvents(settings.webhookEvents), // ✅ ИСПРАВЛЕНО: Parse JSON for MySQL
      notifications: {
        payment_success: settings.notificationPaymentSuccess,
        payment_failed: settings.notificationPaymentFailed,
        refund: settings.notificationRefund,
        payout: settings.notificationPayout,
        login: settings.notificationLogin,
        api_error: settings.notificationApiError,
      },
    };
  }

  async changePassword(shopId: string, passwordData: ChangePasswordRequest): Promise<void> {
    const { currentPassword, newPassword, confirmNewPassword } = passwordData;

    // Validate new password confirmation
    if (newPassword !== confirmNewPassword) {
      throw new Error('New password and confirmation do not match');
    }

    // Validate password strength
    if (newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters long');
    }

    // Get current shop data
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { password: true },
    });

    if (!shop) {
      throw new Error('Shop not found');
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, shop.password);
    if (!isCurrentPasswordValid) {
      throw new Error('Current password is incorrect');
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.shop.update({
      where: { id: shopId },
      data: { password: hashedNewPassword },
    });
  }

  async updateNotifications(shopId: string, notificationData: UpdateNotificationsRequest): Promise<void> {
    // Ensure settings exist
    await this.ensureSettingsExist(shopId);

    const updateData: any = {};
    
    if (notificationData.payment_success !== undefined) {
      updateData.notificationPaymentSuccess = notificationData.payment_success;
    }
    if (notificationData.payment_failed !== undefined) {
      updateData.notificationPaymentFailed = notificationData.payment_failed;
    }
    if (notificationData.refund !== undefined) {
      updateData.notificationRefund = notificationData.refund;
    }
    if (notificationData.payout !== undefined) {
      updateData.notificationPayout = notificationData.payout;
    }
    if (notificationData.login !== undefined) {
      updateData.notificationLogin = notificationData.login;
    }
    if (notificationData.api_error !== undefined) {
      updateData.notificationApiError = notificationData.api_error;
    }

    await prisma.shopSettings.update({
      where: { shopId },
      data: updateData,
    });
  }

  async updateTelegramSettings(shopId: string, telegramData: UpdateTelegramSettingsRequest): Promise<void> {
    // Ensure settings exist
    await this.ensureSettingsExist(shopId);

    const updateData: any = {};
    
    if (telegramData.botApiKey !== undefined) {
      updateData.telegramBotApiKey = telegramData.botApiKey || null;
    }
    if (telegramData.chatId !== undefined) {
      updateData.telegramChatId = telegramData.chatId || null;
    }

    await prisma.shopSettings.update({
      where: { shopId },
      data: updateData,
    });
  }

  async updateWebhookSettings(shopId: string, webhookData: UpdateWebhookSettingsRequest): Promise<void> {
    // Ensure settings exist
    await this.ensureSettingsExist(shopId);

    const updateData: any = {};
    
    if (webhookData.webhookUrl !== undefined) {
      updateData.webhookUrl = webhookData.webhookUrl || null;
    }
    
    if (webhookData.webhookEvents !== undefined) {
      // ✅ ИСПРАВЛЕНО: Store as JSON for MySQL
      updateData.webhookEvents = webhookData.webhookEvents || [];
    }

    await prisma.shopSettings.update({
      where: { shopId },
      data: updateData,
    });
  }

  async revokeAllApiKeys(shopId: string): Promise<void> {
    // Generate new API keys
    const publicKey = 'pk_' + crypto.randomBytes(32).toString('hex');
    const secretKey = 'sk_' + crypto.randomBytes(32).toString('hex');

    await prisma.shop.update({
      where: { id: shopId },
      data: {
        publicKey,
        secretKey,
      },
    });
  }

  async deleteAccount(shopId: string, deleteData: DeleteAccountRequest): Promise<void> {
    const { passwordConfirmation } = deleteData;

    // Get current shop data
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { password: true },
    });

    if (!shop) {
      throw new Error('Shop not found');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(passwordConfirmation, shop.password);
    if (!isPasswordValid) {
      throw new Error('Password confirmation is incorrect');
    }

    // Delete the shop (cascade will handle related records)
    await prisma.shop.delete({
      where: { id: shopId },
    });
  }

  private async ensureSettingsExist(shopId: string): Promise<void> {
    const existingSettings = await prisma.shopSettings.findUnique({
      where: { shopId },
    });

    if (!existingSettings) {
      await prisma.shopSettings.create({
        data: { shopId },
      });
    }
  }
}
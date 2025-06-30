import prisma from '../config/database';
import { IntegrationsResponse, UpdateWebhookSettingsRequest } from '../types/integrations';

export class IntegrationsService {
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

  async getIntegrations(shopId: string): Promise<IntegrationsResponse> {
    // Ensure settings exist first
    await this.ensureSettingsExist(shopId);

    const settings = await prisma.shopSettings.findUnique({
      where: { shopId },
      select: {
        webhookUrl: true,
        webhookEvents: true,
      },
    });

    if (!settings) {
      throw new Error('Shop settings not found');
    }

    return {
      webhook: {
        url: settings.webhookUrl,
        events: this.parseWebhookEvents(settings.webhookEvents), // ✅ ИСПРАВЛЕНО: Parse JSON for MySQL
      },
    };
  }

  async updateWebhookSettings(shopId: string, webhookData: UpdateWebhookSettingsRequest): Promise<void> {
    // Ensure settings exist first
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
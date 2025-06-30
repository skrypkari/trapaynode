import { Request, Response, NextFunction } from 'express';
import { IntegrationsService } from '../services/integrationsService';
import { UpdateWebhookSettingsRequest } from '../types/integrations';

export class IntegrationsController {
  private integrationsService: IntegrationsService;

  constructor() {
    this.integrationsService = new IntegrationsService();
  }

  getIntegrations = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const integrations = await this.integrationsService.getIntegrations(shopId);
      
      res.json({
        success: true,
        result: integrations,
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
      await this.integrationsService.updateWebhookSettings(shopId, webhookData);
      
      res.json({
        success: true,
        message: 'Webhook settings updated successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}
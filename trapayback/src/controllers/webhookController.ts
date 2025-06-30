import { Request, Response, NextFunction } from 'express';
import { WebhookService } from '../services/webhookService';
import { loggerService } from '../services/loggerService';

export class WebhookController {
  private webhookService: WebhookService;

  constructor() {
    this.webhookService = new WebhookService();
  }

  handlePlisioWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log('=== PLISIO WEBHOOK RECEIVED ===');
      console.log('Content-Type:', req.get('Content-Type'));
      console.log('Raw body type:', typeof req.body);
      console.log('Body keys:', Object.keys(req.body || {}));
      console.log('Body content:', req.body);
      
      // Log incoming webhook with headers
      loggerService.logWebhookReceived('plisio', req.body, req.headers);
      
      const result = await this.webhookService.processPlisioWebhook(req.body);
      
      // Plisio expects 200 OK response
      res.status(200).json({
        success: true,
        message: 'Webhook processed successfully',
      });
    } catch (error) {
      console.error('Webhook processing error:', error);
      
      // Log webhook processing error
      loggerService.logWebhookError('plisio', error, req.body);
      
      // Still return 200 to prevent Plisio from retrying
      res.status(200).json({
        success: false,
        message: error instanceof Error ? error.message : 'Webhook processing failed',
      });
    }
  };

  // New Plisio gateway webhook handler
  handlePlisioGatewayWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log('=== PLISIO GATEWAY WEBHOOK RECEIVED ===');
      console.log('Content-Type:', req.get('Content-Type'));
      console.log('Raw body type:', typeof req.body);
      console.log('Body keys:', Object.keys(req.body || {}));
      console.log('Body content:', req.body);
      
      // Log incoming webhook with headers
      loggerService.logWebhookReceived('plisio_gateway', req.body, req.headers);
      
      const result = await this.webhookService.processPlisioGatewayWebhook(req.body);
      
      // Plisio expects 200 OK response
      res.status(200).json({
        success: true,
        message: 'Gateway webhook processed successfully',
      });
    } catch (error) {
      console.error('Gateway webhook processing error:', error);
      
      // Log webhook processing error
      loggerService.logWebhookError('plisio_gateway', error, req.body);
      
      // Still return 200 to prevent Plisio from retrying
      res.status(200).json({
        success: false,
        message: error instanceof Error ? error.message : 'Gateway webhook processing failed',
      });
    }
  };

  // New Rapyd webhook handler
  handleRapydWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log('Received Rapyd webhook:', req.body);
      
      // Log incoming webhook with headers
      loggerService.logWebhookReceived('rapyd', req.body, req.headers);
      
      const result = await this.webhookService.processRapydWebhook(req.body);
      
      // Rapyd expects 200 OK response
      res.status(200).json({
        success: true,
        message: 'Rapyd webhook processed successfully',
      });
    } catch (error) {
      console.error('Rapyd webhook processing error:', error);
      
      // Log webhook processing error
      loggerService.logWebhookError('rapyd', error, req.body);
      
      // Still return 200 to prevent Rapyd from retrying
      res.status(200).json({
        success: false,
        message: error instanceof Error ? error.message : 'Rapyd webhook processing failed',
      });
    }
  };

  // New Noda webhook handler
  handleNodaWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log('Received Noda webhook:', req.body);
      
      // Log incoming webhook with headers
      loggerService.logWebhookReceived('noda', req.body, req.headers);
      
      const result = await this.webhookService.processNodaWebhook(req.body);
      
      // Noda expects 200 OK response
      res.status(200).json({
        success: true,
        message: 'Noda webhook processed successfully',
      });
    } catch (error) {
      console.error('Noda webhook processing error:', error);
      
      // Log webhook processing error
      loggerService.logWebhookError('noda', error, req.body);
      
      // Still return 200 to prevent Noda from retrying
      res.status(200).json({
        success: false,
        message: error instanceof Error ? error.message : 'Noda webhook processing failed',
      });
    }
  };

  // CoinToPay webhook handler
  handleCoinToPayWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log('Received CoinToPay webhook:', req.body);
      
      // Log incoming webhook with headers
      loggerService.logWebhookReceived('cointopay', req.body, req.headers);
      
      const result = await this.webhookService.processCoinToPayWebhook(req.body);
      
      // CoinToPay expects 200 OK response
      res.status(200).json({
        success: true,
        message: 'CoinToPay webhook processed successfully',
      });
    } catch (error) {
      console.error('CoinToPay webhook processing error:', error);
      
      // Log webhook processing error
      loggerService.logWebhookError('cointopay', error, req.body);
      
      // Still return 200 to prevent CoinToPay from retrying
      res.status(200).json({
        success: false,
        message: error instanceof Error ? error.message : 'CoinToPay webhook processing failed',
      });
    }
  };

  // KLYME webhook handler
  handleKlymeWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log('Received KLYME webhook:', req.body);
      
      // Log incoming webhook with headers
      loggerService.logWebhookReceived('klyme', req.body, req.headers);
      
      const result = await this.webhookService.processKlymeWebhook(req.body);
      
      // KLYME expects 200 OK response
      res.status(200).json({
        success: true,
        message: 'KLYME webhook processed successfully',
      });
    } catch (error) {
      console.error('KLYME webhook processing error:', error);
      
      // Log webhook processing error
      loggerService.logWebhookError('klyme', error, req.body);
      
      // Still return 200 to prevent KLYME from retrying
      res.status(200).json({
        success: false,
        message: error instanceof Error ? error.message : 'KLYME webhook processing failed',
      });
    }
  };
}
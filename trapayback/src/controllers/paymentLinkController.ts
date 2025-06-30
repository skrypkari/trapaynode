import { Request, Response, NextFunction } from 'express';
import { PaymentLinkService } from '../services/paymentLinkService';
import { 
  CreatePaymentLinkRequest, 
  UpdatePaymentLinkRequest,
  InitiatePaymentFromLinkRequest 
} from '../types/paymentLink';

export class PaymentLinkController {
  private paymentLinkService: PaymentLinkService;

  constructor() {
    this.paymentLinkService = new PaymentLinkService();
  }

  // POST /api/payment-links - Create new payment link
  createPaymentLink = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const linkData: CreatePaymentLinkRequest = req.body;
      const result = await this.paymentLinkService.createPaymentLink(shopId, linkData);

      res.status(201).json({
        success: true,
        message: 'Payment link created successfully',
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/payment-links - Get payment links for shop
  getPaymentLinks = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const { status, gateway, page = 1, limit = 20, search } = req.query;

      const filters = {
        page: Number(page),
        limit: Number(limit),
        status: status as string,
        gateway: gateway as string,
        search: search as string,
      };

      const result = await this.paymentLinkService.getPaymentLinks(shopId, filters);

      res.json({
        success: true,
        links: result.links,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/payment-links/:id - Get payment link by ID
  getPaymentLinkById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      const { id } = req.params;

      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const link = await this.paymentLinkService.getPaymentLinkById(shopId, id);

      if (!link) {
        return res.status(404).json({
          success: false,
          message: 'Payment link not found',
        });
      }

      res.json({
        success: true,
        result: link,
      });
    } catch (error) {
      next(error);
    }
  };

  // PUT /api/payment-links/:id - Update payment link
  updatePaymentLink = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      const { id } = req.params;

      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const updateData: UpdatePaymentLinkRequest = req.body;
      const result = await this.paymentLinkService.updatePaymentLink(shopId, id, updateData);

      res.json({
        success: true,
        message: 'Payment link updated successfully',
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // DELETE /api/payment-links/:id - Delete payment link
  deletePaymentLink = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      const { id } = req.params;

      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      await this.paymentLinkService.deletePaymentLink(shopId, id);

      res.json({
        success: true,
        message: 'Payment link deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/payment-links/statistics - Get payment link statistics
  getStatistics = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const stats = await this.paymentLinkService.getPaymentLinkStatistics(shopId);

      res.json({
        success: true,
        result: stats,
      });
    } catch (error) {
      next(error);
    }
  };

  // PUBLIC ENDPOINTS (no authentication required)

  // GET /api/public/payment-links/:id - Get public payment link data
  getPublicPaymentLink = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const linkData = await this.paymentLinkService.getPublicPaymentLinkData(id);

      if (!linkData) {
        return res.status(404).json({
          success: false,
          message: 'Payment link not found',
        });
      }

      res.json({
        success: true,
        result: linkData,
      });
    } catch (error) {
      next(error);
    }
  };

  // POST /api/public/payment-links/:id/pay - Initiate payment from link
  initiatePaymentFromLink = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const paymentData: Omit<InitiatePaymentFromLinkRequest, 'linkId'> = req.body;

      const result = await this.paymentLinkService.initiatePaymentFromLink({
        linkId: id,
        ...paymentData,
      });

      res.json({
        success: true,
        message: 'Payment initiated successfully',
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };
}
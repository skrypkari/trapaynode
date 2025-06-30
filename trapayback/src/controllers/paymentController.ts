import { Request, Response, NextFunction } from 'express';
import { PaymentService } from '../services/paymentService';
import { CreatePublicPaymentRequest } from '../types/payment';

export class PaymentController {
  private paymentService: PaymentService;

  constructor() {
    this.paymentService = new PaymentService();
  }

  createPublicPayment = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const paymentData: CreatePublicPaymentRequest = req.body;
      const result = await this.paymentService.createPublicPayment(paymentData);
      
      res.status(201).json({
        success: true,
        message: 'Payment created successfully',
        result: result,
      });
    } catch (error) {
      next(error);
    }
  };

  getPaymentStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const payment = await this.paymentService.getPaymentStatus(id);
      
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

  // New method to get payment by ID (either our ID or shop's order ID)
  getPaymentById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const payment = await this.paymentService.getPaymentById(id);
      
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
}
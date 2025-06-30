import { Request, Response, NextFunction } from 'express';
import { currencyService } from '../services/currencyService';

export class CurrencyController {
  // GET /api/currency/rates - Get all current currency rates
  getRates = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rates = await currencyService.getAllRates();
      
      res.json({
        success: true,
        rates: rates,
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/currency/status - Get currency service status
  getStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await currencyService.getRatesStatus();
      
      res.json({
        success: true,
        status: status,
      });
    } catch (error) {
      next(error);
    }
  };

  // POST /api/currency/update - Manually trigger rates update (admin only)
  updateRates = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await currencyService.updateCurrencyRates();
      
      res.json({
        success: true,
        message: 'Currency rates updated successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  // POST /api/currency/convert - Convert amount between currencies
  convertCurrency = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { amount, fromCurrency, toCurrency = 'usdt' } = req.body;

      if (!amount || !fromCurrency) {
        return res.status(400).json({
          success: false,
          message: 'Amount and fromCurrency are required',
        });
      }

      if (toCurrency.toLowerCase() !== 'usdt') {
        return res.status(400).json({
          success: false,
          message: 'Currently only conversion to USDT is supported',
        });
      }

      const convertedAmount = await currencyService.convertToUSDT(amount, fromCurrency);
      
      res.json({
        success: true,
        result: {
          originalAmount: amount,
          fromCurrency: fromCurrency.toUpperCase(),
          convertedAmount: convertedAmount,
          toCurrency: 'USDT',
        },
      });
    } catch (error) {
      next(error);
    }
  };
}
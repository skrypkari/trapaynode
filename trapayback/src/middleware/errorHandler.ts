import { Request, Response, NextFunction } from 'express';
import { telegramBotService } from '../services/telegramBotService'; // ✅ ДОБАВЛЕНО

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`Error ${statusCode}: ${message}`);
  console.error(err.stack);

  // ✅ ДОБАВЛЕНО: Отправляем уведомление об API ошибке, если это ошибка магазина
  if (req.user?.role === 'shop' && req.user?.id && statusCode >= 400) {
    // Асинхронно отправляем уведомление, не блокируя ответ
    telegramBotService.sendApiErrorNotification(req.user.id, {
      endpoint: req.originalUrl,
      method: req.method,
      errorMessage: message,
      statusCode,
      timestamp: new Date(),
      requestId: req.headers['x-request-id'] as string || undefined,
    }).catch(notificationError => {
      console.error('Failed to send API error notification:', notificationError);
    });
  }

  res.status(statusCode).json({
    success: false,
    message: process.env.NODE_ENV === 'production' && statusCode === 500 
      ? 'Internal Server Error' 
      : message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export const notFound = (req: Request, res: Response, next: NextFunction) => {
  const error: AppError = new Error(`Route ${req.originalUrl} not found`);
  error.statusCode = 404;
  next(error);
};
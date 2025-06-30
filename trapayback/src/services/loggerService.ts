import fs from 'fs';
import path from 'path';

export class LoggerService {
  private logsDir: string;

  constructor() {
    this.logsDir = path.join(process.cwd(), 'logs');
    this.ensureLogsDirectory();
  }

  private ensureLogsDirectory(): void {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
      console.log(`📁 Created logs directory: ${this.logsDir}`);
    }
  }

  private getLogFileName(type: string): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.logsDir, `${type}_${date}.log`);
  }

  private writeLog(type: string, data: any): void {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        ...data,
      };

      const logLine = JSON.stringify(logEntry) + '\n';
      const fileName = this.getLogFileName(type);

      fs.appendFileSync(fileName, logLine, 'utf8');
    } catch (error) {
      console.error(`Failed to write ${type} log:`, error);
    }
  }

  // Log white domain requests and responses
  logWhiteDomainRequest(gateway: string, endpoint: string, method: string, requestData: any): void {
    this.writeLog('white_domain_requests', {
      type: 'REQUEST',
      gateway,
      endpoint,
      method,
      data: requestData,
    });
  }

  logWhiteDomainResponse(gateway: string, endpoint: string, status: number, responseData: any, responseTime: number): void {
    this.writeLog('white_domain_responses', {
      type: 'RESPONSE',
      gateway,
      endpoint,
      status,
      responseTime,
      data: responseData,
    });
  }

  logWhiteDomainError(gateway: string, endpoint: string, error: any): void {
    this.writeLog('white_domain_errors', {
      type: 'ERROR',
      gateway,
      endpoint,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
      } : error,
    });
  }

  // Log webhook data
  logWebhookReceived(gateway: string, webhookData: any, headers?: any): void {
    this.writeLog('webhooks_received', {
      type: 'WEBHOOK_RECEIVED',
      gateway,
      headers,
      data: webhookData,
    });
  }

  logWebhookProcessed(gateway: string, paymentId: string, oldStatus: string, newStatus: string, webhookData: any): void {
    this.writeLog('webhooks_processed', {
      type: 'WEBHOOK_PROCESSED',
      gateway,
      paymentId,
      oldStatus,
      newStatus,
      originalData: webhookData,
    });
  }

  logWebhookError(gateway: string, error: any, webhookData: any): void {
    this.writeLog('webhooks_errors', {
      type: 'WEBHOOK_ERROR',
      gateway,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
      } : error,
      originalData: webhookData,
    });
  }

  // ✅ ДОБАВЛЕНО: Специальные методы для логирования CoinToPay статусов
  logCoinToPayStatus(logData: any): void {
    this.writeLog('cointopay_status_changes', {
      type: 'COINTOPAY_STATUS_CHANGE',
      ...logData,
    });
  }

  logCoinToPayError(logData: any): void {
    this.writeLog('cointopay_errors', {
      type: 'COINTOPAY_ERROR',
      ...logData,
    });
  }

  // Log shop webhook sends
  logShopWebhookSent(shopId: string, webhookUrl: string, event: string, status: number, responseTime: number, payload: any): void {
    this.writeLog('shop_webhooks_sent', {
      type: 'SHOP_WEBHOOK_SENT',
      shopId,
      webhookUrl,
      event,
      status,
      responseTime,
      payload,
    });
  }

  logShopWebhookError(shopId: string, webhookUrl: string, event: string, error: any, payload: any): void {
    this.writeLog('shop_webhooks_errors', {
      type: 'SHOP_WEBHOOK_ERROR',
      shopId,
      webhookUrl,
      event,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
      } : error,
      payload,
    });
  }

  // Log payment creation
  logPaymentCreated(gateway: string, paymentId: string, shopId: string, amount: number, currency: string): void {
    this.writeLog('payments_created', {
      type: 'PAYMENT_CREATED',
      gateway,
      paymentId,
      shopId,
      amount,
      currency,
    });
  }

  // Log general API calls
  logApiCall(endpoint: string, method: string, userId: string, userRole: string, requestData?: any): void {
    this.writeLog('api_calls', {
      type: 'API_CALL',
      endpoint,
      method,
      userId,
      userRole,
      requestData,
    });
  }

  // Get log statistics
  getLogStats(): {
    totalFiles: number;
    logTypes: string[];
    latestLogs: { type: string; date: string; size: number }[];
  } {
    try {
      const files = fs.readdirSync(this.logsDir);
      const logFiles = files.filter(file => file.endsWith('.log'));
      
      const logTypes = [...new Set(logFiles.map(file => file.split('_')[0]))];
      
      const latestLogs = logFiles.map(file => {
        const filePath = path.join(this.logsDir, file);
        const stats = fs.statSync(filePath);
        const [type, date] = file.replace('.log', '').split('_');
        
        return {
          type,
          date,
          size: stats.size,
        };
      }).sort((a, b) => b.date.localeCompare(a.date));

      return {
        totalFiles: logFiles.length,
        logTypes,
        latestLogs: latestLogs.slice(0, 10), // Last 10 log files
      };
    } catch (error) {
      console.error('Failed to get log stats:', error);
      return {
        totalFiles: 0,
        logTypes: [],
        latestLogs: [],
      };
    }
  }

  // Clean old logs (older than specified days)
  cleanOldLogs(daysToKeep: number = 30): void {
    try {
      const files = fs.readdirSync(this.logsDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      let deletedCount = 0;

      files.forEach(file => {
        if (!file.endsWith('.log')) return;

        const filePath = path.join(this.logsDir, file);
        const stats = fs.statSync(filePath);

        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          deletedCount++;
          console.log(`🗑️ Deleted old log file: ${file}`);
        }
      });

      console.log(`🧹 Cleaned ${deletedCount} old log files (older than ${daysToKeep} days)`);
    } catch (error) {
      console.error('Failed to clean old logs:', error);
    }
  }
}

// Export singleton instance
export const loggerService = new LoggerService();
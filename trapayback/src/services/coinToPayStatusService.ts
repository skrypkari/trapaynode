import { CoinToPayService } from './gateways/coinToPayService';
import prisma from '../config/database';
import { telegramBotService } from './telegramBotService';
import { loggerService } from './loggerService';

export class CoinToPayStatusService {
  private coinToPayService: CoinToPayService;
  private globalCheckInterval: NodeJS.Timeout | null = null;
  private readonly GLOBAL_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 час для глобальной проверки
  private readonly EXPIRY_DAYS = 5; // 5 дней до автоматического истечения
  
  // ✅ ДОБАВЛЕНО: Хранилище индивидуальных таймеров для платежей
  private paymentTimers: Map<string, {
    timers: NodeJS.Timeout[];
    paymentId: string;
    gatewayPaymentId: string;
    createdAt: Date;
  }> = new Map();

  constructor() {
    this.coinToPayService = new CoinToPayService();
    console.log('🪙 CoinToPayStatusService initialized');
  }

  // ✅ ДОБАВЛЕНО: Метод для создания индивидуального расписания проверок для платежа
  schedulePaymentChecks(paymentId: string, gatewayPaymentId: string): void {
    console.log(`🪙 [DEBUG] schedulePaymentChecks called with:`);
    console.log(`   - paymentId: ${paymentId}`);
    console.log(`   - gatewayPaymentId: ${gatewayPaymentId}`);

    // Очищаем существующие таймеры для этого платежа (если есть)
    this.clearPaymentTimers(paymentId);

    const timers: NodeJS.Timeout[] = [];
    const createdAt = new Date();

    // Расписание проверок: 1 мин, 2 мин, 7 мин, 12 мин, затем каждый час
    const checkSchedule = [
      { delay: 1 * 60 * 1000, description: '1 minute' },      // 1 минута
      { delay: 2 * 60 * 1000, description: '2 minutes' },     // 2 минуты (итого 2 мин)
      { delay: 5 * 60 * 1000, description: '5 minutes' },     // 5 минут (итого 7 мин)
      { delay: 5 * 60 * 1000, description: '5 minutes' },     // 5 минут (итого 12 мин)
    ];

    console.log(`🪙 [DEBUG] Creating ${checkSchedule.length} initial timers for payment ${paymentId}`);

    // Создаем таймеры для начальных проверок
    let cumulativeDelay = 0;
    checkSchedule.forEach((schedule, index) => {
      cumulativeDelay += schedule.delay;
      
      const timer = setTimeout(async () => {
        console.log(`🪙 [TIMER] Individual check #${index + 1} triggered for payment ${paymentId} (after ${schedule.description})`);
        
        try {
          await this.checkSinglePaymentById(paymentId);
          console.log(`✅ [TIMER] Individual check #${index + 1} completed for payment ${paymentId}`);
        } catch (error) {
          console.error(`❌ [TIMER] Failed individual check #${index + 1} for payment ${paymentId}:`, error);
          
          this.logCoinToPayError(
            paymentId,
            gatewayPaymentId,
            error,
            'status_check',
            {
              checkNumber: index + 1,
              scheduledAfter: schedule.description,
              isIndividualCheck: true,
            }
          );
        }
      }, cumulativeDelay);

      timers.push(timer);
      console.log(`⏰ [DEBUG] Scheduled check #${index + 1} for payment ${paymentId} in ${cumulativeDelay / 1000} seconds (${schedule.description})`);
    });

    // Создаем таймер для часовых проверок (начиная через 1 час после создания)
    const hourlyTimer = setInterval(async () => {
      console.log(`🪙 [HOURLY] Hourly check triggered for payment ${paymentId}`);
      
      try {
        // Проверяем, не истек ли платеж
        const payment = await prisma.payment.findUnique({
          where: { id: paymentId },
          select: { 
            id: true, 
            status: true, 
            createdAt: true,
            gatewayPaymentId: true,
          },
        });

        if (!payment) {
          console.log(`❌ [HOURLY] Payment ${paymentId} not found, clearing timers`);
          this.clearPaymentTimers(paymentId);
          return;
        }

        console.log(`📊 [HOURLY] Payment ${paymentId} current status: ${payment.status}`);

        // Если платеж уже не PENDING, останавливаем проверки
        if (payment.status !== 'PENDING') {
          console.log(`✅ [HOURLY] Payment ${paymentId} status is ${payment.status}, stopping individual checks`);
          this.clearPaymentTimers(paymentId);
          return;
        }

        // Проверяем, не истек ли платеж по времени
        const daysSinceCreation = Math.floor((Date.now() - payment.createdAt.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceCreation >= this.EXPIRY_DAYS) {
          console.log(`⏰ [HOURLY] Payment ${paymentId} is older than ${this.EXPIRY_DAYS} days, will be handled by global expiry check`);
          this.clearPaymentTimers(paymentId);
          return;
        }

        await this.checkSinglePaymentById(paymentId);
        console.log(`✅ [HOURLY] Hourly check completed for payment ${paymentId}`);
      } catch (error) {
        console.error(`❌ [HOURLY] Failed hourly check for payment ${paymentId}:`, error);
        
        this.logCoinToPayError(
          paymentId,
          gatewayPaymentId,
          error,
          'status_check',
          {
            isHourlyCheck: true,
            isIndividualCheck: true,
          }
        );
      }
    }, 60 * 60 * 1000); // Каждый час

    timers.push(hourlyTimer);

    // Сохраняем таймеры
    this.paymentTimers.set(paymentId, {
      timers,
      paymentId,
      gatewayPaymentId,
      createdAt,
    });

    console.log(`✅ [DEBUG] Successfully scheduled ${checkSchedule.length} initial checks + hourly checks for payment ${paymentId}`);
    console.log(`📊 [DEBUG] Total active payment timers: ${this.paymentTimers.size}`);
    
    // ✅ ДОБАВЛЕНО: Логируем создание расписания
    this.logCoinToPayStatus(
      paymentId,
      gatewayPaymentId,
      'PENDING',
      'PENDING',
      'status_check',
      {
        action: 'schedule_created',
        scheduledChecks: checkSchedule.length,
        firstCheckIn: checkSchedule[0].delay / 1000,
        totalTimers: this.paymentTimers.size,
      }
    );
  }

  // ✅ ДОБАВЛЕНО: Метод для очистки таймеров конкретного платежа
  clearPaymentTimers(paymentId: string): void {
    const timerData = this.paymentTimers.get(paymentId);
    
    if (timerData) {
      console.log(`🧹 [DEBUG] Clearing ${timerData.timers.length} timers for payment ${paymentId}`);
      
      timerData.timers.forEach((timer, index) => {
        if (timer) {
          clearTimeout(timer);
          clearInterval(timer);
          console.log(`🧹 [DEBUG] Cleared timer #${index + 1} for payment ${paymentId}`);
        }
      });
      
      this.paymentTimers.delete(paymentId);
      console.log(`✅ [DEBUG] All timers cleared for payment ${paymentId}. Remaining active timers: ${this.paymentTimers.size}`);
    } else {
      console.log(`⚠️ [DEBUG] No timers found for payment ${paymentId} to clear`);
    }
  }

  // ✅ ДОБАВЛЕНО: Метод для проверки конкретного платежа по ID
  private async checkSinglePaymentById(paymentId: string): Promise<void> {
    console.log(`🔍 [CHECK] Starting check for payment ID: ${paymentId}`);
    
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        gatewayPaymentId: true,
        amount: true,
        currency: true,
        status: true,
        shopId: true,
        createdAt: true,
        gateway: true, // ✅ ДОБАВЛЕНО: Проверяем gateway
        shop: {
          select: {
            id: true,
            name: true,
            settings: {
              select: {
                webhookUrl: true,
                webhookEvents: true,
              },
            },
          },
        },
      },
    });

    if (!payment) {
      console.log(`❌ [CHECK] Payment ${paymentId} not found in database`);
      return;
    }

    console.log(`📊 [CHECK] Payment ${paymentId} found:`);
    console.log(`   - Gateway: ${payment.gateway}`);
    console.log(`   - Status: ${payment.status}`);
    console.log(`   - GatewayPaymentId: ${payment.gatewayPaymentId}`);
    console.log(`   - Amount: ${payment.amount} ${payment.currency}`);
    console.log(`   - ShopId: ${payment.shopId}`);

    if (payment.gateway !== 'cointopay') {
      console.log(`⚠️ [CHECK] Payment ${paymentId} is not a CoinToPay payment (gateway: ${payment.gateway})`);
      return;
    }

    if (payment.status !== 'PENDING') {
      console.log(`⚠️ [CHECK] Payment ${paymentId} status is ${payment.status}, stopping individual checks`);
      this.clearPaymentTimers(paymentId);
      return;
    }

    if (!payment.gatewayPaymentId) {
      console.log(`⚠️ [CHECK] Payment ${paymentId} has no gatewayPaymentId`);
      return;
    }

    console.log(`✅ [CHECK] Payment ${paymentId} is valid for checking, proceeding...`);
    await this.checkSinglePayment(payment);
  }

  // ✅ ДОБАВЛЕНО: Метод для логирования статусов CoinToPay
  private logCoinToPayStatus(
    paymentId: string,
    gatewayPaymentId: string,
    oldStatus: string,
    newStatus: string,
    source: 'webhook' | 'status_check' | 'auto_expire',
    details?: any
  ): void {
    const logData = {
      type: 'COINTOPAY_STATUS_CHANGE',
      paymentId,
      gatewayPaymentId,
      oldStatus,
      newStatus,
      source,
      timestamp: new Date().toISOString(),
      details: details || {},
    };

    // Логируем в специальный файл для CoinToPay статусов
    loggerService.logCoinToPayStatus(logData);

    console.log(`🪙 [LOG] CoinToPay Status Change: ${paymentId} (${gatewayPaymentId})`);
    console.log(`   📊 Status: ${oldStatus} -> ${newStatus}`);
    console.log(`   📍 Source: ${source}`);
    console.log(`   📅 Time: ${logData.timestamp}`);
    
    if (details) {
      console.log(`   📝 Details:`, details);
    }
  }

  // ✅ ДОБАВЛЕНО: Метод для логирования ошибок CoinToPay
  private logCoinToPayError(
    paymentId: string,
    gatewayPaymentId: string,
    error: any,
    source: 'webhook' | 'status_check' | 'auto_expire',
    context?: any
  ): void {
    const logData = {
      type: 'COINTOPAY_ERROR',
      paymentId,
      gatewayPaymentId,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
      } : error,
      source,
      timestamp: new Date().toISOString(),
      context: context || {},
    };

    // Логируем в специальный файл для CoinToPay ошибок
    loggerService.logCoinToPayError(logData);

    console.error(`🪙 [ERROR] CoinToPay Error: ${paymentId} (${gatewayPaymentId})`);
    console.error(`   ❌ Error: ${error instanceof Error ? error.message : error}`);
    console.error(`   📍 Source: ${source}`);
    console.error(`   📅 Time: ${logData.timestamp}`);
    
    if (context) {
      console.error(`   📝 Context:`, context);
    }
  }

  // Start periodic status checking for CoinToPay payments
  startPeriodicStatusCheck(): void {
    console.log('🪙 [INIT] Starting CoinToPay periodic status checking (global checks every 1 hour)');

    // Check immediately on start
    this.checkAllPendingPayments().catch(error => {
      console.error('❌ [INIT] Initial CoinToPay status check failed:', error);
    });

    // Set up periodic checks (теперь только для глобальной проверки и истечения)
    this.globalCheckInterval = setInterval(async () => {
      try {
        console.log('🪙 [GLOBAL] Starting global check cycle...');
        await this.checkAllPendingPayments();
        console.log('✅ [GLOBAL] Global check cycle completed');
      } catch (error) {
        console.error('❌ [GLOBAL] Periodic CoinToPay status check failed:', error);
      }
    }, this.GLOBAL_CHECK_INTERVAL_MS);

    console.log('✅ [INIT] CoinToPay status checking service started (global hourly checks + individual payment timers)');
  }

  // Stop periodic status checking
  stopPeriodicStatusCheck(): void {
    console.log('🛑 [SHUTDOWN] Stopping CoinToPay status checking service...');
    
    if (this.globalCheckInterval) {
      clearInterval(this.globalCheckInterval);
      this.globalCheckInterval = null;
      console.log('🛑 [SHUTDOWN] CoinToPay global status checking stopped');
    }

    // ✅ ДОБАВЛЕНО: Очищаем все индивидуальные таймеры
    const timerCount = this.paymentTimers.size;
    for (const [paymentId] of this.paymentTimers) {
      this.clearPaymentTimers(paymentId);
    }
    
    console.log(`🛑 [SHUTDOWN] Cleared ${timerCount} individual payment timers`);
  }

  // Check all pending CoinToPay payments (теперь в основном для истечения и резервной проверки)
  private async checkAllPendingPayments(): Promise<void> {
    try {
      console.log('🪙 [GLOBAL] Getting all pending CoinToPay payments...');
      
      // Get all pending CoinToPay payments
      const pendingPayments = await prisma.payment.findMany({
        where: {
          gateway: 'cointopay',
          status: 'PENDING',
          gatewayPaymentId: { not: null },
        },
        select: {
          id: true,
          gatewayPaymentId: true,
          amount: true,
          currency: true,
          status: true,
          shopId: true,
          createdAt: true,
          shop: {
            select: {
              id: true,
              name: true,
              settings: {
                select: {
                  webhookUrl: true,
                  webhookEvents: true,
                },
              },
            },
          },
        },
      });

      console.log(`🪙 [GLOBAL] Found ${pendingPayments.length} pending CoinToPay payments`);

      if (pendingPayments.length === 0) {
        console.log('🪙 [GLOBAL] No pending CoinToPay payments to check');
        return;
      }

      // ✅ Check for expired payments first
      const expiredPayments = await this.checkExpiredPayments(pendingPayments);
      console.log(`⏰ [GLOBAL] Found ${expiredPayments.length} expired CoinToPay payments`);

      // ✅ ИЗМЕНЕНО: Теперь глобальная проверка в основном для резервной проверки и старых платежей
      let checkedCount = 0;
      let skippedCount = 0;
      
      for (const payment of pendingPayments) {
        try {
          // Skip if already marked as expired
          if (expiredPayments.includes(payment.id)) {
            console.log(`⏰ [GLOBAL] Payment ${payment.id} already marked as expired, skipping global check`);
            skippedCount++;
            continue;
          }

          // ✅ ДОБАВЛЕНО: Пропускаем платежи, которые имеют индивидуальные таймеры (созданы недавно)
          if (this.paymentTimers.has(payment.id)) {
            console.log(`⏰ [GLOBAL] Payment ${payment.id} has individual timers, skipping global check`);
            skippedCount++;
            continue;
          }

          // Проверяем только старые платежи (старше 1 часа) в глобальной проверке
          const ageInHours = (Date.now() - payment.createdAt.getTime()) / (1000 * 60 * 60);
          if (ageInHours < 1) {
            console.log(`⏰ [GLOBAL] Payment ${payment.id} is too new (${ageInHours.toFixed(1)}h), skipping global check`);
            skippedCount++;
            continue;
          }

          console.log(`🔍 [GLOBAL] Checking old payment ${payment.id} (age: ${ageInHours.toFixed(1)}h)`);
          await this.checkSinglePayment(payment);
          checkedCount++;
          
          // Add delay between requests
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          console.error(`❌ [GLOBAL] Failed to check CoinToPay payment ${payment.id}:`, error);
          
          this.logCoinToPayError(
            payment.id,
            payment.gatewayPaymentId || 'unknown',
            error,
            'status_check',
            {
              isGlobalCheck: true,
              paymentAmount: payment.amount,
              paymentCurrency: payment.currency,
              shopId: payment.shopId,
              createdAt: payment.createdAt,
            }
          );
          
          loggerService.logWhiteDomainError('cointopay', `/status/${payment.gatewayPaymentId}`, error);
        }
      }

      console.log(`✅ [GLOBAL] Global check completed: ${checkedCount} checked, ${skippedCount} skipped, ${expiredPayments.length} expired`);

    } catch (error) {
      console.error('❌ [GLOBAL] Failed to get pending CoinToPay payments:', error);
    }
  }

  // ✅ Check for payments that should be expired (older than 5 days)
  private async checkExpiredPayments(pendingPayments: any[]): Promise<string[]> {
    const expiredPaymentIds: string[] = [];
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - this.EXPIRY_DAYS);

    console.log(`⏰ [EXPIRY] Checking for CoinToPay payments older than ${this.EXPIRY_DAYS} days (created before ${fiveDaysAgo.toISOString()})`);

    for (const payment of pendingPayments) {
      if (payment.createdAt < fiveDaysAgo) {
        console.log(`⏰ [EXPIRY] Payment ${payment.id} is older than ${this.EXPIRY_DAYS} days, marking as EXPIRED`);
        
        try {
          // ✅ ДОБАВЛЕНО: Логируем автоматическое истечение
          this.logCoinToPayStatus(
            payment.id,
            payment.gatewayPaymentId || 'unknown',
            'PENDING',
            'EXPIRED',
            'auto_expire',
            {
              reason: `Payment older than ${this.EXPIRY_DAYS} days`,
              createdAt: payment.createdAt,
              daysSinceCreation: Math.floor((Date.now() - payment.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
              paymentAmount: payment.amount,
              paymentCurrency: payment.currency,
              shopId: payment.shopId,
            }
          );

          // Update payment status to EXPIRED
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: 'EXPIRED',
              updatedAt: new Date(),
              adminNotes: `Automatically expired after ${this.EXPIRY_DAYS} days without payment confirmation`,
            },
          });

          // Log expiry action
          await prisma.webhookLog.create({
            data: {
              paymentId: payment.id,
              shopId: payment.shopId,
              event: 'cointopay_auto_expired',
              statusCode: 200,
              responseBody: JSON.stringify({
                reason: `Payment older than ${this.EXPIRY_DAYS} days`,
                createdAt: payment.createdAt,
                expiredAt: new Date().toISOString(),
                daysSinceCreation: Math.floor((Date.now() - payment.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
              }),
            },
          });

          // Send webhook to shop
          await this.sendShopWebhook(payment, 'EXPIRED');

          // Send Telegram notification
          await this.sendPaymentStatusNotification(payment, 'EXPIRED');

          // ✅ ДОБАВЛЕНО: Очищаем индивидуальные таймеры для истекшего платежа
          this.clearPaymentTimers(payment.id);

          expiredPaymentIds.push(payment.id);

          console.log(`✅ [EXPIRY] Payment ${payment.id} marked as EXPIRED due to ${this.EXPIRY_DAYS}-day timeout`);

        } catch (error) {
          console.error(`❌ [EXPIRY] Failed to expire payment ${payment.id}:`, error);
          
          // ✅ ДОБАВЛЕНО: Логируем ошибку автоматического истечения
          this.logCoinToPayError(
            payment.id,
            payment.gatewayPaymentId || 'unknown',
            error,
            'auto_expire',
            {
              reason: 'Failed to mark payment as expired',
              createdAt: payment.createdAt,
              daysSinceCreation: Math.floor((Date.now() - payment.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
            }
          );
        }
      }
    }

    return expiredPaymentIds;
  }

  // Check single payment status
  private async checkSinglePayment(payment: any): Promise<void> {
    if (!payment.gatewayPaymentId) {
      console.log(`⚠️ [CHECK] Payment ${payment.id} has no gatewayPaymentId, skipping`);
      return;
    }

    console.log(`🔍 [CHECK] Checking CoinToPay payment ${payment.id} (${payment.gatewayPaymentId})`);

    try {
      // Check payment status
      const statusResult = await this.coinToPayService.checkPaymentStatus(payment.gatewayPaymentId);

      console.log(`📊 [CHECK] Payment ${payment.id} status: ${statusResult.status}`);

      // Log specific status details
      if (statusResult.paymentDetails) {
        console.log(`📊 [CHECK] Payment ${payment.id} details:`, {
          iban: statusResult.paymentDetails.iban || 'not found',
          transactionId: statusResult.paymentDetails.transactionId,
          createdOn: statusResult.paymentDetails.createdOn,
          confirmedOn: statusResult.paymentDetails.confirmedOn || 'not confirmed',
        });
      }

      // Only update if status changed
      if (statusResult.status !== payment.status) {
        console.log(`🔄 [CHECK] Updating payment ${payment.id} status from ${payment.status} to ${statusResult.status}`);

        // ✅ ДОБАВЛЕНО: Логируем изменение статуса
        this.logCoinToPayStatus(
          payment.id,
          payment.gatewayPaymentId,
          payment.status,
          statusResult.status,
          'status_check',
          {
            paymentDetails: statusResult.paymentDetails,
            amount: statusResult.amount,
            currency: statusResult.currency,
            shopId: payment.shopId,
            checkTimestamp: new Date().toISOString(),
          }
        );

        // Prepare update data
        const updateData: any = {
          status: statusResult.status,
          updatedAt: new Date(),
        };

        // If payment became successful, set paid_at
        if (statusResult.status === 'PAID' && payment.status !== 'PAID') {
          updateData.paidAt = new Date();
          console.log(`💰 [CHECK] Payment ${payment.id} marked as paid at: ${updateData.paidAt.toISOString()}`);
        }

        // Save payment details if available
        if (statusResult.paymentDetails) {
          const details = statusResult.paymentDetails;
          
          if (details.iban) {
            updateData.remitterIban = details.iban;
            console.log(`🏦 [CHECK] Saved IBAN: ${details.iban}`);
          }
          
          if (details.bankDetails) {
            // Store bank details in admin notes
            const existingNotes = payment.adminNotes || '';
            const bankDetailsNote = `Bank Details: ${details.bankDetails}`;
            updateData.adminNotes = existingNotes ? `${existingNotes}\n\n${bankDetailsNote}` : bankDetailsNote;
            console.log(`🏦 [CHECK] Saved bank details to admin notes`);
          }
          
          if (details.transactionId) {
            console.log(`🆔 [CHECK] Transaction ID: ${details.transactionId}`);
          }

          if (details.confirmedOn) {
            console.log(`✅ [CHECK] Transaction confirmed on: ${details.confirmedOn}`);
          }
        }

        // Update payment in database
        await prisma.payment.update({
          where: { id: payment.id },
          data: updateData,
        });

        // Log status change
        await prisma.webhookLog.create({
          data: {
            paymentId: payment.id,
            shopId: payment.shopId,
            event: `cointopay_status_check_${statusResult.status.toLowerCase()}`,
            statusCode: 200,
            responseBody: JSON.stringify({
              oldStatus: payment.status,
              newStatus: statusResult.status,
              paymentDetails: statusResult.paymentDetails,
              checkedAt: new Date().toISOString(),
            }),
          },
        });

        // Send webhook to shop if configured
        await this.sendShopWebhook(payment, statusResult.status);

        // Send Telegram notification
        await this.sendPaymentStatusNotification(payment, statusResult.status);

        // ✅ ДОБАВЛЕНО: Если платеж завершен (не PENDING), очищаем индивидуальные таймеры
        if (statusResult.status !== 'PENDING') {
          console.log(`🧹 [CHECK] Payment ${payment.id} status changed to ${statusResult.status}, clearing individual timers`);
          this.clearPaymentTimers(payment.id);
        }

        console.log(`✅ [CHECK] Payment ${payment.id} updated successfully`);
      } else {
        console.log(`📊 [CHECK] Payment ${payment.id} status unchanged (${statusResult.status})`);
        
        // ✅ ДОБАВЛЕНО: Логируем даже если статус не изменился (для отслеживания проверок)
        this.logCoinToPayStatus(
          payment.id,
          payment.gatewayPaymentId,
          payment.status,
          statusResult.status,
          'status_check',
          {
            statusUnchanged: true,
            paymentDetails: statusResult.paymentDetails,
            amount: statusResult.amount,
            currency: statusResult.currency,
            shopId: payment.shopId,
            checkTimestamp: new Date().toISOString(),
          }
        );
      }

    } catch (error) {
      console.error(`❌ [CHECK] Failed to check payment ${payment.id}:`, error);
      
      // ✅ ДОБАВЛЕНО: Логируем ошибку проверки статуса
      this.logCoinToPayError(
        payment.id,
        payment.gatewayPaymentId,
        error,
        'status_check',
        {
          paymentAmount: payment.amount,
          paymentCurrency: payment.currency,
          shopId: payment.shopId,
          createdAt: payment.createdAt,
        }
      );
      
      // Log webhook error for this specific payment
      await prisma.webhookLog.create({
        data: {
          paymentId: payment.id,
          shopId: payment.shopId,
          event: 'cointopay_status_check_error',
          statusCode: 500,
          responseBody: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            gatewayPaymentId: payment.gatewayPaymentId,
            checkedAt: new Date().toISOString(),
          }),
        },
      });
    }
  }

  // Send webhook to shop
  private async sendShopWebhook(payment: any, status: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      const shop = payment.shop;
      const settings = shop.settings;

      if (!settings?.webhookUrl) {
        console.log(`No webhook URL configured for shop ${shop.id}`);
        return;
      }

      // Check if this event type is enabled
      const eventName = status === 'PAID' ? 'payment.success' : 
                       status === 'FAILED' ? 'payment.failed' : 
                       status === 'EXPIRED' ? 'payment.failed' : 'payment.pending';

      if (!settings.webhookEvents?.includes(eventName)) {
        console.log(`Webhook event ${eventName} not enabled for shop ${shop.id}`);
        return;
      }

      // Prepare webhook payload for shop
      const webhookPayload = {
        event: eventName,
        payment: {
          id: payment.id,
          order_id: payment.orderId,
          gateway_order_id: payment.gatewayOrderId,
          gateway: '0100', // CoinToPay gateway ID
          amount: payment.amount,
          currency: payment.currency,
          status: status.toLowerCase(),
          customer_email: payment.customerEmail,
          customer_name: payment.customerName,
          created_at: payment.createdAt,
          updated_at: new Date(),
        },
      };

      // Send webhook to shop
      const response = await fetch(settings.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TesSoft Payment System/1.0',
        },
        body: JSON.stringify(webhookPayload),
      });

      const responseTime = Date.now() - startTime;
      const responseText = response.ok ? 'Success' : await response.text();

      // Log shop webhook
      loggerService.logShopWebhookSent(
        payment.shopId,
        settings.webhookUrl,
        eventName,
        response.status,
        responseTime,
        webhookPayload
      );

      console.log(`Shop webhook sent to ${settings.webhookUrl} with status ${response.status} (${responseTime}ms)`);

    } catch (error) {
      console.error('Failed to send shop webhook:', error);
      
      // Log shop webhook error
      loggerService.logShopWebhookError(
        payment.shopId,
        payment.shop?.settings?.webhookUrl || 'unknown',
        'webhook_send',
        error,
        {}
      );
    }
  }

  // Send Telegram notification
  private async sendPaymentStatusNotification(payment: any, status: string): Promise<void> {
    try {
      const statusMap: Record<string, 'created' | 'paid' | 'failed' | 'expired'> = {
        'PENDING': 'created',
        'PAID': 'paid',
        'FAILED': 'failed',
        'EXPIRED': 'expired',
      };

      const telegramStatus = statusMap[status];
      if (!telegramStatus || telegramStatus === 'created') return;

      await telegramBotService.sendPaymentNotification(payment.shopId, payment, telegramStatus);
    } catch (error) {
      console.error('Failed to send Telegram payment notification:', error);
    }
  }

  // Manual method to check specific payment
  async checkPaymentById(paymentId: string): Promise<void> {
    console.log(`🔍 [MANUAL] Manual check requested for payment: ${paymentId}`);
    
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            settings: {
              select: {
                webhookUrl: true,
                webhookEvents: true,
              },
            },
          },
        },
      },
    });

    if (!payment) {
      throw new Error('Payment not found');
    }

    if (payment.gateway !== 'cointopay') {
      throw new Error('Payment is not a CoinToPay payment');
    }

    console.log(`✅ [MANUAL] Starting manual check for CoinToPay payment ${paymentId}`);
    await this.checkSinglePayment(payment);
    console.log(`✅ [MANUAL] Manual check completed for payment ${paymentId}`);
  }

  // ✅ ОБНОВЛЕНО: Method to get service statistics
  getServiceStats(): {
    isActive: boolean;
    globalCheckIntervalMinutes: number;
    expiryDays: number;
    activeIndividualTimers: number;
    nextGlobalCheckIn?: number;
    paymentTimersDetails: Array<{
      paymentId: string;
      gatewayPaymentId: string;
      createdAt: Date;
      timersCount: number;
    }>;
  } {
    const nextGlobalCheckIn = this.globalCheckInterval ? this.GLOBAL_CHECK_INTERVAL_MS : undefined;
    
    // ✅ ДОБАВЛЕНО: Детали активных таймеров
    const paymentTimersDetails = Array.from(this.paymentTimers.values()).map(timer => ({
      paymentId: timer.paymentId,
      gatewayPaymentId: timer.gatewayPaymentId,
      createdAt: timer.createdAt,
      timersCount: timer.timers.length,
    }));
    
    return {
      isActive: !!this.globalCheckInterval,
      globalCheckIntervalMinutes: this.GLOBAL_CHECK_INTERVAL_MS / (1000 * 60),
      expiryDays: this.EXPIRY_DAYS,
      activeIndividualTimers: this.paymentTimers.size,
      nextGlobalCheckIn,
      paymentTimersDetails,
    };
  }

  // ✅ ДОБАВЛЕНО: Метод для получения информации о конкретном платеже
  getPaymentTimerInfo(paymentId: string): {
    hasTimers: boolean;
    timersCount?: number;
    createdAt?: Date;
    gatewayPaymentId?: string;
  } {
    const timerData = this.paymentTimers.get(paymentId);
    
    if (timerData) {
      return {
        hasTimers: true,
        timersCount: timerData.timers.length,
        createdAt: timerData.createdAt,
        gatewayPaymentId: timerData.gatewayPaymentId,
      };
    }
    
    return { hasTimers: false };
  }
}

// Export singleton instance
export const coinToPayStatusService = new CoinToPayStatusService();
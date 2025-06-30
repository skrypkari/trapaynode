import prisma from '../config/database';
import { PlisioService } from './gateways/plisioService';
import { RapydService } from './gateways/rapydService';
import { NodaService } from './gateways/nodaService';
import { CoinToPayService } from './gateways/coinToPayService';
import { KlymeService } from './gateways/klymeService';
import { PaymentLinkService } from './paymentLinkService';
import { telegramBotService } from './telegramBotService';
import { loggerService } from './loggerService';
import { getGatewayIdByName } from '../types/gateway';

export class WebhookService {
  private plisioService: PlisioService;
  private rapydService: RapydService;
  private nodaService: NodaService;
  private coinToPayService: CoinToPayService;
  private klymeService: KlymeService;
  private paymentLinkService: PaymentLinkService;

  constructor() {
    this.plisioService = new PlisioService();
    this.rapydService = new RapydService();
    this.nodaService = new NodaService();
    this.coinToPayService = new CoinToPayService();
    this.klymeService = new KlymeService();
    this.paymentLinkService = new PaymentLinkService();
  }

  // Helper method to parse webhook events from JSON
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

  // ✅ ДОБАВЛЕНО: Метод для логирования статусов CoinToPay в webhook
  private logCoinToPayWebhookStatus(
    paymentId: string,
    gatewayPaymentId: string,
    oldStatus: string,
    newStatus: string,
    webhookData: any
  ): void {
    const logData = {
      type: 'COINTOPAY_WEBHOOK_STATUS_CHANGE',
      paymentId,
      gatewayPaymentId,
      oldStatus,
      newStatus,
      source: 'webhook',
      timestamp: new Date().toISOString(),
      webhookData,
    };

    // Логируем в специальный файл для CoinToPay статусов
    loggerService.logCoinToPayStatus(logData);

    console.log(`🪙 CoinToPay Webhook Status Change: ${paymentId} (${gatewayPaymentId})`);
    console.log(`   📊 Status: ${oldStatus} -> ${newStatus}`);
    console.log(`   📍 Source: webhook`);
    console.log(`   📅 Time: ${logData.timestamp}`);
    console.log(`   📝 Webhook Data:`, webhookData);
  }

  async processPlisioWebhook(webhookData: any): Promise<void> {
    try {
      // Log incoming webhook
      loggerService.logWebhookReceived('plisio', webhookData);

      // Логируем входящий webhook
      console.log('Processing Plisio webhook:', webhookData);

      // Извлекаем данные из webhook
      const {
        txn_id: gatewayPaymentId,
        order_number: orderId,
        status: plisioStatus,
        amount,
        currency,
      } = webhookData;

      if (!gatewayPaymentId || !orderId) {
        const error = new Error('Missing required webhook data: txn_id or order_number');
        loggerService.logWebhookError('plisio', error, webhookData);
        throw error;
      }

      // Находим платеж в базе данных
      const payment = await prisma.payment.findFirst({
        where: {
          OR: [
            { gatewayPaymentId },
            { orderId },
          ],
        },
        include: {
          shop: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!payment) {
        const error = new Error(`Payment not found for gateway_id: ${gatewayPaymentId}, order_id: ${orderId}`);
        loggerService.logWebhookError('plisio', error, webhookData);
        throw error;
      }

      // ✅ ОБНОВЛЕНО: Преобразуем статус Plisio в наш статус с поддержкой PROCESSING
      let newStatus: 'PENDING' | 'PROCESSING' | 'PAID' | 'EXPIRED' | 'FAILED';
      
      switch (plisioStatus) {
        case 'completed':
        case 'mismatch': // Частично оплачен, но считаем успешным
          newStatus = 'PAID';
          break;
        case 'pending': // ✅ ДОБАВЛЕНО: pending (не new) -> PROCESSING
          newStatus = 'PROCESSING';
          break;
        case 'expired':
          newStatus = 'EXPIRED';
          break;
        case 'error':
        case 'cancelled':
          newStatus = 'FAILED';
          break;
        case 'new':
        default:
          newStatus = 'PENDING';
          break;
      }

      console.log(`🔄 Plisio status mapping: "${plisioStatus}" -> "${newStatus}"`);

      // Подготавливаем данные для обновления
      const updateData: any = {
        status: newStatus,
        updatedAt: new Date(),
      };

      // Если платеж стал успешным, устанавливаем paid_at
      if (newStatus === 'PAID' && payment.status !== 'PAID') {
        updateData.paidAt = new Date();
        console.log(`💰 Payment ${payment.id} marked as paid at: ${updateData.paidAt.toISOString()}`);
      }

      // Обновляем статус платежа только если он изменился
      if (payment.status !== newStatus) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: updateData,
        });

        console.log(`Payment ${payment.id} status updated from ${payment.status} to ${newStatus}`);

        // Log successful webhook processing
        loggerService.logWebhookProcessed('plisio', payment.id, payment.status, newStatus, webhookData);

        // Handle payment link success
        if (newStatus === 'PAID') {
          await this.paymentLinkService.handleSuccessfulPayment(payment.id);
        }

        // Send Telegram notification
        await this.sendPaymentStatusNotification(payment, newStatus);
      }

      // Логируем webhook
      await prisma.webhookLog.create({
        data: {
          paymentId: payment.id,
          shopId: payment.shopId,
          event: `plisio_${plisioStatus}`,
          statusCode: 200,
          responseBody: JSON.stringify(webhookData),
        },
      });

    } catch (error) {
      console.error('Webhook processing error:', error);
      
      // Log webhook error
      loggerService.logWebhookError('plisio', error, webhookData);
      
      // Логируем ошибку webhook
      try {
        await prisma.webhookLog.create({
          data: {
            paymentId: 'unknown',
            shopId: 'unknown',
            event: 'plisio_error',
            statusCode: 500,
            responseBody: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown error',
              webhookData,
            }),
          },
        });
      } catch (logError) {
        console.error('Failed to log webhook error:', logError);
      }
      
      throw error;
    }
  }

  // ✅ ОБНОВЛЕНО: New method for processing Plisio gateway webhook with PROCESSING status support
  async processPlisioGatewayWebhook(webhookData: any): Promise<void> {
    try {
      // Log incoming webhook
      loggerService.logWebhookReceived('plisio_gateway', webhookData);

      console.log('Processing Plisio gateway webhook:', webhookData);

      const {
        txn_id: gatewayPaymentId,
        order_number: orderId,
        status: plisioStatus,
        amount,
        currency,
        source_currency,
        source_amount,
        invoice_total_sum,
        invoice_commission,
        invoice_sum,
        confirmations,
        verify_hash,
        merchant,
        merchant_id,
        ipn_type,
        order_name,
        comment,
      } = webhookData;

      if (!gatewayPaymentId || !orderId) {
        const error = new Error('Missing required webhook data: txn_id or order_number');
        loggerService.logWebhookError('plisio_gateway', error, webhookData);
        throw error;
      }

      // Find payment in database by our internal ID (order_number contains our payment ID)
      const payment = await prisma.payment.findFirst({
        where: {
          OR: [
            { id: orderId }, // Our internal payment ID
            { gatewayPaymentId }, // Gateway payment ID
            { gatewayOrderId: orderId }, // Gateway order ID (8digits-8digits)
          ],
        },
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
        const error = new Error(`Payment not found for order_number: ${orderId}, txn_id: ${gatewayPaymentId}`);
        loggerService.logWebhookError('plisio_gateway', error, webhookData);
        throw error;
      }

      // ✅ ОБНОВЛЕНО: Map Plisio status to our status with PROCESSING support
      let newStatus: 'PENDING' | 'PROCESSING' | 'PAID' | 'EXPIRED' | 'FAILED';
      
      switch (plisioStatus?.toLowerCase()) {
        case 'completed':
        case 'mismatch': // Overpaid - consider as paid
          newStatus = 'PAID';
          break;
        case 'pending': // ✅ ДОБАВЛЕНО: pending (не new) -> PROCESSING
          newStatus = 'PROCESSING';
          break;
        case 'expired':
          newStatus = 'EXPIRED';
          break;
        case 'error':
        case 'cancelled':
          newStatus = 'FAILED';
          break;
        case 'new':
        case 'pending internal':
        default:
          newStatus = 'PENDING';
          break;
      }

      console.log(`🔄 Plisio gateway status mapping: "${plisioStatus}" -> "${newStatus}"`);

      // Подготавливаем данные для обновления
      const updateData: any = {
        status: newStatus,
        updatedAt: new Date(),
      };

      // Если платеж стал успешным, устанавливаем paid_at
      if (newStatus === 'PAID' && payment.status !== 'PAID') {
        updateData.paidAt = new Date();
        console.log(`💰 Payment ${payment.id} marked as paid at: ${updateData.paidAt.toISOString()}`);
      }

      // Update payment status only if it changed
      if (payment.status !== newStatus) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: updateData,
        });

        console.log(`Payment ${payment.id} status updated from ${payment.status} to ${newStatus}`);

        // Log successful webhook processing
        loggerService.logWebhookProcessed('plisio_gateway', payment.id, payment.status, newStatus, webhookData);

        // Handle payment link success
        if (newStatus === 'PAID') {
          await this.paymentLinkService.handleSuccessfulPayment(payment.id);
        }

        // Send webhook to shop if configured
        await this.sendShopWebhook(payment, newStatus, webhookData);

        // Send Telegram notification
        await this.sendPaymentStatusNotification(payment, newStatus);
      }

      // Log webhook
      await prisma.webhookLog.create({
        data: {
          paymentId: payment.id,
          shopId: payment.shopId,
          event: `plisio_gateway_${plisioStatus}`,
          statusCode: 200,
          responseBody: JSON.stringify(webhookData),
        },
      });

    } catch (error) {
      console.error('Gateway webhook processing error:', error);
      
      // Log webhook error
      loggerService.logWebhookError('plisio_gateway', error, webhookData);
      
      // Log webhook error
      try {
        await prisma.webhookLog.create({
          data: {
            paymentId: 'unknown',
            shopId: 'unknown',
            event: 'plisio_gateway_error',
            statusCode: 500,
            responseBody: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown error',
              webhookData,
            }),
          },
        });
      } catch (logError) {
        console.error('Failed to log gateway webhook error:', logError);
      }
      
      throw error;
    }
  }

  // Updated method for processing Rapyd webhook with card details extraction
  async processRapydWebhook(webhookData: any): Promise<void> {
    try {
      // Log incoming webhook
      loggerService.logWebhookReceived('rapyd', webhookData);

      console.log('Processing Rapyd webhook:', webhookData);

      const {
        id: webhookId,
        type: eventType,
        data: eventData,
        created_at,
      } = webhookData;

      if (!eventData?.id) {
        const error = new Error('Missing required webhook data: data.id');
        loggerService.logWebhookError('rapyd', error, webhookData);
        throw error;
      }

      const gatewayPaymentId = eventData.id;
      const merchantReferenceId = eventData.merchant_reference_id;

      // Find payment in database
      const payment = await prisma.payment.findFirst({
        where: {
          OR: [
            { gatewayPaymentId }, // Rapyd payment ID
            { id: merchantReferenceId }, // Our internal payment ID
            { gatewayOrderId: merchantReferenceId }, // Gateway order ID (8digits-8digits)
          ],
        },
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
        const error = new Error(`Payment not found for gateway_id: ${gatewayPaymentId}, merchant_reference_id: ${merchantReferenceId}`);
        loggerService.logWebhookError('rapyd', error, webhookData);
        throw error;
      }

      // Extract payment details from Rapyd webhook
      let cardLast4: string | null = null;
      let paymentMethod: string | null = null;

      if (eventData.payment_method_data) {
        cardLast4 = eventData.payment_method_data.last4 || null;
        paymentMethod = eventData.payment_method_data.type || eventData.payment_method_type || null;
      }

      // Map Rapyd event type and status to our status
      let newStatus: 'PENDING' | 'PROCESSING' | 'PAID' | 'EXPIRED' | 'FAILED';
      
      // First check event type
      switch (eventType?.toUpperCase()) {
        case 'PAYMENT_COMPLETED':
          // Check if payment is actually paid
          if (eventData.paid === true && eventData.status === 'CLO') {
            newStatus = 'PAID';
          } else {
            newStatus = 'PROCESSING'; // ✅ ИЗМЕНЕНО: PENDING -> PROCESSING для промежуточных состояний
          }
          break;
        
        case 'PAYMENT_CANCELED':
          newStatus = 'FAILED';
          break;
        
        case 'PAYMENT_EXPIRED':
          newStatus = 'EXPIRED';
          break;
        
        case 'PAYMENT_FAILED':
          newStatus = 'FAILED';
          break;
        
        default:
          // For other events, check the data.status field
          switch (eventData.status?.toUpperCase()) {
            case 'CLO': // Closed - completed
              if (eventData.paid === true) {
                newStatus = 'PAID';
              } else {
                newStatus = 'FAILED';
              }
              break;
            case 'CAN': // Cancelled
              newStatus = 'FAILED';
              break;
            case 'EXP': // Expired
              newStatus = 'EXPIRED';
              break;
            case 'ERR': // Error
              newStatus = 'FAILED';
              break;
            case 'ACT': // Active - processing
              newStatus = 'PROCESSING'; // ✅ ДОБАВЛЕНО: ACT -> PROCESSING
              break;
            case 'NEW':
            default:
              newStatus = 'PENDING';
              break;
          }
          break;
      }

      // Prepare update data
      const updateData: any = {
        status: newStatus,
        updatedAt: new Date(),
      };

      // Add payment details if available
      if (cardLast4) {
        updateData.cardLast4 = cardLast4;
        console.log(`💳 Extracted card last 4 digits: ****${cardLast4}`);
      }

      if (paymentMethod) {
        updateData.paymentMethod = paymentMethod;
        console.log(`💳 Payment method: ${paymentMethod}`);
      }

      // Если платеж стал успешным, устанавливаем paid_at
      if (newStatus === 'PAID' && payment.status !== 'PAID') {
        updateData.paidAt = new Date();
        console.log(`💰 Payment ${payment.id} marked as paid at: ${updateData.paidAt.toISOString()}`);
      }

      // Update payment status and details only if status changed or we have new details
      if (payment.status !== newStatus || cardLast4 || paymentMethod) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: updateData,
        });

        if (payment.status !== newStatus) {
          console.log(`Payment ${payment.id} status updated from ${payment.status} to ${newStatus}`);
          
          // Log successful webhook processing
          loggerService.logWebhookProcessed('rapyd', payment.id, payment.status, newStatus, webhookData);

          // Handle payment link success
          if (newStatus === 'PAID') {
            await this.paymentLinkService.handleSuccessfulPayment(payment.id);
          }

          // Send webhook to shop if configured
          await this.sendShopWebhook(payment, newStatus, webhookData);

          // Send Telegram notification
          await this.sendPaymentStatusNotification(payment, newStatus);
        }

        if (cardLast4 || paymentMethod) {
          console.log(`Payment ${payment.id} details updated: card_last4=${cardLast4}, payment_method=${paymentMethod}`);
        }
      }

      // Log webhook
      await prisma.webhookLog.create({
        data: {
          paymentId: payment.id,
          shopId: payment.shopId,
          event: `rapyd_${eventType}`,
          statusCode: 200,
          responseBody: JSON.stringify(webhookData),
        },
      });

    } catch (error) {
      console.error('Rapyd webhook processing error:', error);
      
      // Log webhook error
      loggerService.logWebhookError('rapyd', error, webhookData);
      
      // Log webhook error
      try {
        await prisma.webhookLog.create({
          data: {
            paymentId: 'unknown',
            shopId: 'unknown',
            event: 'rapyd_error',
            statusCode: 500,
            responseBody: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown error',
              webhookData,
            }),
          },
        });
      } catch (logError) {
        console.error('Failed to log Rapyd webhook error:', logError);
      }
      
      throw error;
    }
  }

  // ✅ ОБНОВЛЕНО: Updated method for processing Noda webhook with Processing and Awaiting confirmation support
  async processNodaWebhook(webhookData: any): Promise<void> {
    try {
      // Log incoming webhook
      loggerService.logWebhookReceived('noda', webhookData);

      console.log('Processing Noda webhook:', webhookData);

      // Extract data from Noda webhook based on the provided example
      const {
        PaymentId: nodaPaymentId,
        Status: nodaStatus,
        Signature: signature,
        MerchantPaymentId: merchantPaymentId,
        Reference: reference,
        Amount: amount,
        Currency: currency,
        CardId: cardId,
        Remitter: remitter,
        AdditionalData: additionalData,
        DetailedInfo: detailedInfo,
        Method: method,
        BankId: bankId,
        IsSenderBank: isSenderBank,
        BankTransactionId: bankTransactionId,
        Settled: settled,
        SettlementDate: settlementDate,
      } = webhookData;

      if (!nodaPaymentId && !merchantPaymentId) {
        const error = new Error('Missing required webhook data: PaymentId or MerchantPaymentId');
        loggerService.logWebhookError('noda', error, webhookData);
        throw error;
      }

      console.log(`🔍 Searching for Noda payment:`);
      console.log(`   - PaymentId: ${nodaPaymentId}`);
      console.log(`   - MerchantPaymentId: ${merchantPaymentId}`);

      // ИСПРАВЛЕНО: Расширенный поиск платежа для Noda
      const payment = await prisma.payment.findFirst({
        where: {
          OR: [
            // 1. По gateway payment ID (Noda PaymentId)
            { gatewayPaymentId: nodaPaymentId },
            // 2. По нашему внутреннему ID (если MerchantPaymentId = наш payment.id)
            { id: merchantPaymentId },
            // 3. По gateway order ID (если MerchantPaymentId = gateway order ID в формате 8digits-8digits)
            { gatewayOrderId: merchantPaymentId },
            // 4. По merchant order ID (если есть)
            { orderId: merchantPaymentId },
          ],
        },
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
        console.log(`❌ Payment not found with any of the following criteria:`);
        console.log(`   - gatewayPaymentId: ${nodaPaymentId}`);
        console.log(`   - id: ${merchantPaymentId}`);
        console.log(`   - gatewayOrderId: ${merchantPaymentId}`);
        console.log(`   - orderId: ${merchantPaymentId}`);

        // Попробуем найти все платежи для отладки
        const allPayments = await prisma.payment.findMany({
          select: {
            id: true,
            gatewayPaymentId: true,
            gatewayOrderId: true,
            orderId: true,
            gateway: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });

        console.log(`🔍 Last 10 payments in database for debugging:`);
        allPayments.forEach(p => {
          console.log(`   - ID: ${p.id}, Gateway: ${p.gateway}, GatewayPaymentId: ${p.gatewayPaymentId}, GatewayOrderId: ${p.gatewayOrderId}, OrderId: ${p.orderId}, Status: ${p.status}`);
        });

        const error = new Error(`Payment not found for PaymentId: ${nodaPaymentId}, MerchantPaymentId: ${merchantPaymentId}`);
        loggerService.logWebhookError('noda', error, webhookData);
        throw error;
      }

      console.log(`✅ Found payment: ${payment.id} (gateway: ${payment.gateway})`);
      console.log(`   - gatewayPaymentId: ${payment.gatewayPaymentId}`);
      console.log(`   - gatewayOrderId: ${payment.gatewayOrderId}`);
      console.log(`   - orderId: ${payment.orderId}`);

      // Extract remitter details
      let remitterIban: string | null = null;
      let remitterName: string | null = null;

      if (remitter) {
        remitterIban = remitter.Iban || null;
        remitterName = remitter.Name || null;
      }

      // ✅ ОБНОВЛЕНО: Map Noda status to our status with Processing and Awaiting confirmation support
      let newStatus: 'PENDING' | 'PROCESSING' | 'PAID' | 'EXPIRED' | 'FAILED';
      
      switch (nodaStatus?.toLowerCase()) {
        case 'done':
        case 'completed':
        case 'paid':
        case 'success':
        case 'successful':
          // Additional check: if Settled is "Yes", consider it fully paid
          if (settled === 'Yes' || settled === true) {
            newStatus = 'PAID';
          } else {
            newStatus = 'PROCESSING'; // ✅ ИЗМЕНЕНО: Payment done but not yet settled -> PROCESSING
          }
          break;
        case 'processing': // ✅ ДОБАВЛЕНО: Явно обрабатываем processing статус
        case 'awaiting confirmation': // ✅ ДОБАВЛЕНО: Обрабатываем awaiting confirmation
        case 'in_progress':
          newStatus = 'PROCESSING';
          break;
        case 'cancelled':
        case 'canceled':
        case 'failed':
        case 'error':
        case 'rejected':
          newStatus = 'FAILED';
          break;
        case 'expired':
        case 'timeout':
          newStatus = 'EXPIRED';
          break;
        case 'pending':
        case 'created':
        case 'active':
        default:
          newStatus = 'PENDING';
          break;
      }

      console.log(`🔄 Noda status mapping: "${nodaStatus}" -> "${newStatus}"`);

      // Prepare update data
      const updateData: any = {
        status: newStatus,
        updatedAt: new Date(),
      };

      // Add payment details if available
      if (remitterIban) {
        updateData.remitterIban = remitterIban;
        console.log(`🏦 Extracted remitter IBAN: ${remitterIban}`);
      }

      if (remitterName) {
        updateData.remitterName = remitterName;
        console.log(`👤 Remitter name: ${remitterName}`);
      }

      if (bankId) {
        updateData.bankId = bankId;
        console.log(`🏦 Bank ID: ${bankId}`);
      }

      if (method) {
        updateData.paymentMethod = method;
        console.log(`💳 Payment method: ${method}`);
      }

      // Если платеж стал успешным, устанавливаем paid_at
      if (newStatus === 'PAID' && payment.status !== 'PAID') {
        updateData.paidAt = new Date();
        console.log(`💰 Payment ${payment.id} marked as paid at: ${updateData.paidAt.toISOString()}`);
      }

      // Update payment status and details only if status changed or we have new details
      if (payment.status !== newStatus || remitterIban || remitterName || bankId || method) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: updateData,
        });

        if (payment.status !== newStatus) {
          console.log(`Payment ${payment.id} status updated from ${payment.status} to ${newStatus}`);
          
          // Log successful webhook processing
          loggerService.logWebhookProcessed('noda', payment.id, payment.status, newStatus, webhookData);

          // Handle payment link success
          if (newStatus === 'PAID') {
            await this.paymentLinkService.handleSuccessfulPayment(payment.id);
          }

          // Send webhook to shop if configured
          await this.sendShopWebhook(payment, newStatus, webhookData);

          // Send Telegram notification
          await this.sendPaymentStatusNotification(payment, newStatus);
        }

        if (remitterIban || remitterName || bankId || method) {
          console.log(`Payment ${payment.id} details updated: iban=${remitterIban}, name=${remitterName}, bank=${bankId}, method=${method}`);
        }
      }

      // Log webhook with additional Noda-specific information
      await prisma.webhookLog.create({
        data: {
          paymentId: payment.id,
          shopId: payment.shopId,
          event: `noda_${nodaStatus}`,
          statusCode: 200,
          responseBody: JSON.stringify({
            ...webhookData,
            // Add parsed information for easier debugging
            parsed: {
              nodaPaymentId,
              merchantPaymentId,
              status: nodaStatus,
              amount,
              currency,
              method,
              bankId,
              settled,
              settlementDate,
              remitterName: remitter?.Name,
              remitterIban: remitter?.Iban,
            },
          }),
        },
      });

      console.log(`Noda webhook processed successfully for payment ${payment.id}`);
      console.log(`Status: ${nodaStatus} -> ${newStatus}, Amount: ${amount} ${currency}, Method: ${method}`);
      console.log(`Bank: ${bankId}, Settled: ${settled}, Settlement Date: ${settlementDate}`);
      console.log(`Remitter: ${remitterName} (${remitterIban})`);

    } catch (error) {
      console.error('Noda webhook processing error:', error);
      
      // Log webhook error
      loggerService.logWebhookError('noda', error, webhookData);
      
      // Log webhook error
      try {
        await prisma.webhookLog.create({
          data: {
            paymentId: 'unknown',
            shopId: 'unknown',
            event: 'noda_error',
            statusCode: 500,
            responseBody: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown error',
              webhookData,
            }),
          },
        });
      } catch (logError) {
        console.error('Failed to log Noda webhook error:', logError);
      }
      
      throw error;
    }
  }

  // ✅ ОБНОВЛЕНО: CoinToPay webhook handler с детальным логированием
  async processCoinToPayWebhook(webhookData: any): Promise<void> {
    try {
      // Log incoming webhook
      loggerService.logWebhookReceived('cointopay', webhookData);

      console.log('Processing CoinToPay webhook:', webhookData);

      const {
        order_id: orderId,
        gateway_payment_id: gatewayPaymentId,
        status: coinToPayStatus,
        amount,
        currency,
        transaction_id,
        confirmation_count,
      } = webhookData;

      if (!orderId && !gatewayPaymentId) {
        const error = new Error('Missing required webhook data: order_id or gateway_payment_id');
        loggerService.logWebhookError('cointopay', error, webhookData);
        throw error;
      }

      // Find payment in database
      const payment = await prisma.payment.findFirst({
        where: {
          OR: [
            { gatewayPaymentId }, // CoinToPay payment ID
            { id: orderId }, // Our internal payment ID
            { gatewayOrderId: orderId }, // Gateway order ID (8digits-8digits)
            { orderId: orderId }, // Merchant order ID
          ],
        },
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
        const error = new Error(`Payment not found for order_id: ${orderId}, gateway_payment_id: ${gatewayPaymentId}`);
        loggerService.logWebhookError('cointopay', error, webhookData);
        throw error;
      }

      // Map CoinToPay status to our status
      let newStatus: 'PENDING' | 'PROCESSING' | 'PAID' | 'EXPIRED' | 'FAILED';
      
      switch (coinToPayStatus?.toLowerCase()) {
        case 'paid':
        case 'completed':
        case 'confirmed':
          newStatus = 'PAID';
          break;
        case 'processing':
        case 'confirming':
          newStatus = 'PROCESSING'; // ✅ ДОБАВЛЕНО: Промежуточные статусы -> PROCESSING
          break;
        case 'cancelled':
        case 'failed':
        case 'error':
          newStatus = 'FAILED';
          break;
        case 'expired':
        case 'timeout':
          newStatus = 'EXPIRED';
          break;
        case 'pending':
        case 'waiting':
        case 'created':
        default:
          newStatus = 'PENDING';
          break;
      }

      console.log(`🔄 CoinToPay status mapping: "${coinToPayStatus}" -> "${newStatus}"`);

      // Prepare update data
      const updateData: any = {
        status: newStatus,
        updatedAt: new Date(),
      };

      // Если платеж стал успешным, устанавливаем paid_at
      if (newStatus === 'PAID' && payment.status !== 'PAID') {
        updateData.paidAt = new Date();
        console.log(`💰 Payment ${payment.id} marked as paid at: ${updateData.paidAt.toISOString()}`);
      }

      // Update payment status only if it changed
      if (payment.status !== newStatus) {
        // ✅ ДОБАВЛЕНО: Логируем изменение статуса через webhook
        this.logCoinToPayWebhookStatus(
          payment.id,
          gatewayPaymentId || payment.gatewayPaymentId || 'unknown',
          payment.status,
          newStatus,
          webhookData
        );

        await prisma.payment.update({
          where: { id: payment.id },
          data: updateData,
        });

        console.log(`Payment ${payment.id} status updated from ${payment.status} to ${newStatus}`);
        
        // Log successful webhook processing
        loggerService.logWebhookProcessed('cointopay', payment.id, payment.status, newStatus, webhookData);

        // Handle payment link success
        if (newStatus === 'PAID') {
          await this.paymentLinkService.handleSuccessfulPayment(payment.id);
        }

        // Send webhook to shop if configured
        await this.sendShopWebhook(payment, newStatus, webhookData);

        // Send Telegram notification
        await this.sendPaymentStatusNotification(payment, newStatus);
      } else {
        // ✅ ДОБАВЛЕНО: Логируем даже если статус не изменился (для отслеживания webhook'ов)
        this.logCoinToPayWebhookStatus(
          payment.id,
          gatewayPaymentId || payment.gatewayPaymentId || 'unknown',
          payment.status,
          newStatus,
          {
            ...webhookData,
            statusUnchanged: true,
            note: 'Webhook received but status unchanged',
          }
        );
      }

      // Log webhook
      await prisma.webhookLog.create({
        data: {
          paymentId: payment.id,
          shopId: payment.shopId,
          event: `cointopay_${coinToPayStatus}`,
          statusCode: 200,
          responseBody: JSON.stringify(webhookData),
        },
      });

      console.log(`CoinToPay webhook processed successfully for payment ${payment.id}`);
      console.log(`Status: ${coinToPayStatus} -> ${newStatus}, Amount: ${amount} ${currency || 'EUR'}`);

    } catch (error) {
      console.error('CoinToPay webhook processing error:', error);
      
      // ✅ ДОБАВЛЕНО: Логируем ошибку webhook
      const paymentId = webhookData?.order_id || 'unknown';
      const gatewayPaymentId = webhookData?.gateway_payment_id || 'unknown';
      
      const logData = {
        type: 'COINTOPAY_WEBHOOK_ERROR',
        paymentId,
        gatewayPaymentId,
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
        } : error,
        source: 'webhook',
        timestamp: new Date().toISOString(),
        webhookData,
      };

      loggerService.logCoinToPayError(logData);
      
      // Log webhook error
      loggerService.logWebhookError('cointopay', error, webhookData);
      
      // Log webhook error
      try {
        await prisma.webhookLog.create({
          data: {
            paymentId: paymentId,
            shopId: 'unknown',
            event: 'cointopay_error',
            statusCode: 500,
            responseBody: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown error',
              webhookData,
            }),
          },
        });
      } catch (logError) {
        console.error('Failed to log CoinToPay webhook error:', logError);
      }
      
      throw error;
    }
  }

  // New method for processing KLYME webhook
  async processKlymeWebhook(webhookData: any): Promise<void> {
    try {
      // Log incoming webhook
      loggerService.logWebhookReceived('klyme', webhookData);

      console.log('Processing KLYME webhook:', webhookData);

      const {
        payment_id: klymePaymentId,
        order_id: orderId,
        status: klymeStatus,
        amount,
        currency,
        region,
        customer_email,
        customer_name,
        payment_method,
        transaction_id,
      } = webhookData;

      if (!orderId && !klymePaymentId) {
        const error = new Error('Missing required webhook data: order_id or payment_id');
        loggerService.logWebhookError('klyme', error, webhookData);
        throw error;
      }

      console.log(`🔍 Searching for KLYME ${region} payment:`);
      console.log(`   - PaymentId: ${klymePaymentId}`);
      console.log(`   - OrderId: ${orderId}`);

      // Find payment in database
      const payment = await prisma.payment.findFirst({
        where: {
          OR: [
            { gatewayPaymentId: klymePaymentId }, // KLYME payment ID
            { id: orderId }, // Our internal payment ID
            { gatewayOrderId: orderId }, // Gateway order ID (8digits-8digits)
            { orderId: orderId }, // Merchant order ID
          ],
        },
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
        console.log(`❌ KLYME payment not found with any of the following criteria:`);
        console.log(`   - gatewayPaymentId: ${klymePaymentId}`);
        console.log(`   - id: ${orderId}`);
        console.log(`   - gatewayOrderId: ${orderId}`);
        console.log(`   - orderId: ${orderId}`);

        const error = new Error(`Payment not found for payment_id: ${klymePaymentId}, order_id: ${orderId}`);
        loggerService.logWebhookError('klyme', error, webhookData);
        throw error;
      }

      console.log(`✅ Found KLYME payment: ${payment.id} (gateway: ${payment.gateway})`);

      // Map KLYME status to our status
      let newStatus: 'PENDING' | 'PROCESSING' | 'PAID' | 'EXPIRED' | 'FAILED';
      
      switch (klymeStatus?.toLowerCase()) {
        case 'paid':
        case 'completed':
        case 'confirmed':
        case 'success':
        case 'successful':
          newStatus = 'PAID';
          break;
        case 'processing':
        case 'active':
        case 'in_progress':
          newStatus = 'PROCESSING'; // ✅ ДОБАВЛЕНО: Промежуточные статусы -> PROCESSING
          break;
        case 'cancelled':
        case 'canceled':
        case 'failed':
        case 'error':
        case 'rejected':
          newStatus = 'FAILED';
          break;
        case 'expired':
        case 'timeout':
          newStatus = 'EXPIRED';
          break;
        case 'pending':
        case 'created':
        default:
          newStatus = 'PENDING';
          break;
      }

      // Prepare update data
      const updateData: any = {
        status: newStatus,
        updatedAt: new Date(),
      };

      // Add payment details if available
      if (payment_method) {
        updateData.paymentMethod = payment_method;
        console.log(`💳 KLYME payment method: ${payment_method}`);
      }

      // Если платеж стал успешным, устанавливаем paid_at
      if (newStatus === 'PAID' && payment.status !== 'PAID') {
        updateData.paidAt = new Date();
        console.log(`💰 Payment ${payment.id} marked as paid at: ${updateData.paidAt.toISOString()}`);
      }

      // Update payment status and details only if status changed or we have new details
      if (payment.status !== newStatus || payment_method) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: updateData,
        });

        if (payment.status !== newStatus) {
          console.log(`Payment ${payment.id} status updated from ${payment.status} to ${newStatus}`);
          
          // Log successful webhook processing
          loggerService.logWebhookProcessed('klyme', payment.id, payment.status, newStatus, webhookData);

          // Handle payment link success
          if (newStatus === 'PAID') {
            await this.paymentLinkService.handleSuccessfulPayment(payment.id);
          }

          // Send webhook to shop if configured
          await this.sendShopWebhook(payment, newStatus, webhookData);

          // Send Telegram notification
          await this.sendPaymentStatusNotification(payment, newStatus);
        }

        if (payment_method) {
          console.log(`Payment ${payment.id} details updated: payment_method=${payment_method}`);
        }
      }

      // Log webhook with KLYME-specific information
      await prisma.webhookLog.create({
        data: {
          paymentId: payment.id,
          shopId: payment.shopId,
          event: `klyme_${region?.toLowerCase()}_${klymeStatus}`,
          statusCode: 200,
          responseBody: JSON.stringify({
            ...webhookData,
            // Add parsed information for easier debugging
            parsed: {
              klymePaymentId,
              orderId,
              status: klymeStatus,
              amount,
              currency,
              region,
              payment_method,
              transaction_id,
            },
          }),
        },
      });

      console.log(`KLYME ${region} webhook processed successfully for payment ${payment.id}`);
      console.log(`Status: ${klymeStatus} -> ${newStatus}, Amount: ${amount} ${currency}, Region: ${region}`);
      console.log(`Payment Method: ${payment_method}, Transaction ID: ${transaction_id}`);

    } catch (error) {
      console.error('KLYME webhook processing error:', error);
      
      // Log webhook error
      loggerService.logWebhookError('klyme', error, webhookData);
      
      // Log webhook error
      try {
        await prisma.webhookLog.create({
          data: {
            paymentId: 'unknown',
            shopId: 'unknown',
            event: 'klyme_error',
            statusCode: 500,
            responseBody: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown error',
              webhookData,
            }),
          },
        });
      } catch (logError) {
        console.error('Failed to log KLYME webhook error:', logError);
      }
      
      throw error;
    }
  }

  // Updated sendShopWebhook method to send gateway ID instead of name and remove gateway_data
  private async sendShopWebhook(payment: any, status: string, originalWebhookData: any): Promise<void> {
    const startTime = Date.now();
    
    try {
      const shop = payment.shop;
      const settings = shop.settings;

      if (!settings?.webhookUrl) {
        console.log(`No webhook URL configured for shop ${shop.id}`);
        return;
      }

      // Parse webhook events from JSON for MySQL
      const webhookEvents = this.parseWebhookEvents(settings.webhookEvents);

      // Check if this event type is enabled
      const eventName = status === 'PAID' ? 'payment.success' : 
                       status === 'FAILED' ? 'payment.failed' : 'payment.pending';
      
      if (!webhookEvents.includes(eventName)) {
        console.log(`Webhook event ${eventName} not enabled for shop ${shop.id}`);
        return;
      }

      // Get gateway ID instead of name
      const gatewayId = getGatewayIdByName(payment.gateway);

      // Prepare webhook payload for shop
      const webhookPayload = {
        event: eventName,
        payment: {
          id: payment.id,
          order_id: payment.orderId,
          gateway_order_id: payment.gatewayOrderId,
          gateway: gatewayId || payment.gateway, // Send gateway ID instead of name
          amount: payment.amount,
          currency: payment.currency,
          status: status.toLowerCase(),
          customer_email: payment.customerEmail,
          customer_name: payment.customerName,
          // Include payment details
          card_last4: payment.cardLast4,
          payment_method: payment.paymentMethod,
          bank_id: payment.bankId,
          remitter_iban: payment.remitterIban,
          remitter_name: payment.remitterName,
          created_at: payment.createdAt,
          updated_at: payment.updatedAt,
        },
      };

      console.log(`🔗 Sending webhook to shop with gateway ID: ${gatewayId} (was: ${payment.gateway})`);

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

      // Log webhook attempt
      await prisma.webhookLog.create({
        data: {
          paymentId: payment.id,
          shopId: payment.shopId,
          event: `shop_webhook_${eventName}`,
          statusCode: response.status,
          responseBody: responseText,
        },
      });

      console.log(`Shop webhook sent to ${settings.webhookUrl} with status ${response.status} (${responseTime}ms)`);

    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      console.error('Failed to send shop webhook:', error);
      
      // Log shop webhook error
      loggerService.logShopWebhookError(
        payment.shopId,
        payment.shop?.settings?.webhookUrl || 'unknown',
        'webhook_send',
        error,
        {}
      );
      
      // Log webhook failure
      try {
        await prisma.webhookLog.create({
          data: {
            paymentId: payment.id,
            shopId: payment.shopId,
            event: 'shop_webhook_error',
            statusCode: 0,
            responseBody: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown error',
              responseTime,
            }),
          },
        });
      } catch (logError) {
        console.error('Failed to log shop webhook error:', logError);
      }
    }
  }

  // ✅ ОБНОВЛЕНО: Новый метод для отправки Telegram уведомлений с поддержкой PROCESSING статуса
  private async sendPaymentStatusNotification(payment: any, status: string): Promise<void> {
    try {
      console.log(`📱 Processing Telegram notification for payment ${payment.id}, status: ${status}`);

      // Получаем настройки уведомлений магазина
      const shopSettings = await prisma.shopSettings.findUnique({
        where: { shopId: payment.shopId },
        select: {
          notificationPaymentSuccess: true,
          notificationPaymentFailed: true,
          notificationRefund: true,
          notificationPayout: true,
          notificationLogin: true,
          notificationApiError: true,
        },
      });

      if (!shopSettings) {
        console.log(`📱 No shop settings found for shop ${payment.shopId}, skipping Telegram notification`);
        return;
      }

      console.log(`📱 Shop notification settings:`, {
        payment_success: shopSettings.notificationPaymentSuccess,
        payment_failed: shopSettings.notificationPaymentFailed,
        refund: shopSettings.notificationRefund,
        payout: shopSettings.notificationPayout,
        login: shopSettings.notificationLogin,
        api_error: shopSettings.notificationApiError,
      });

      // ✅ ОБНОВЛЕНО: Проверяем, нужно ли отправлять уведомление для данного статуса (включая PROCESSING)
      let shouldSendNotification = false;
      let telegramStatus: 'created' | 'paid' | 'failed' | 'expired' | 'refund' | 'chargeback' | 'processing';

      switch (status) {
        case 'PENDING':
          // Отправляем уведомление о создании платежа, если включены уведомления о неудачных платежах
          if (shopSettings.notificationPaymentFailed) {
            shouldSendNotification = true;
            telegramStatus = 'created';
          }
          break;

        case 'PROCESSING': // ✅ ДОБАВЛЕНО: Поддержка PROCESSING статуса
          // Отправляем уведомление о обработке платежа, если включены уведомления о неудачных платежах
          if (shopSettings.notificationPaymentFailed) {
            shouldSendNotification = true;
            telegramStatus = 'processing';
          }
          break;

        case 'PAID':
          // Успешная оплата - проверяем настройку payment_success
          if (shopSettings.notificationPaymentSuccess) {
            shouldSendNotification = true;
            telegramStatus = 'paid';
          }
          break;

        case 'FAILED':
          // Неудачная оплата - проверяем настройку payment_failed
          if (shopSettings.notificationPaymentFailed) {
            shouldSendNotification = true;
            telegramStatus = 'failed';
          }
          break;

        case 'EXPIRED':
          // Истекший платеж - проверяем настройку payment_failed
          if (shopSettings.notificationPaymentFailed) {
            shouldSendNotification = true;
            telegramStatus = 'expired';
          }
          break;

        case 'REFUND':
          // Возврат - проверяем настройку refund
          if (shopSettings.notificationRefund) {
            shouldSendNotification = true;
            telegramStatus = 'refund';
          }
          break;

        case 'CHARGEBACK':
          // Чарджбэк - проверяем настройку refund (используем как общую для возвратов)
          if (shopSettings.notificationRefund) {
            shouldSendNotification = true;
            telegramStatus = 'chargeback';
          }
          break;

        default:
          console.log(`📱 Unknown payment status: ${status}, skipping Telegram notification`);
          return;
      }

      if (!shouldSendNotification) {
        console.log(`📱 Telegram notification disabled for status: ${status} in shop settings`);
        return;
      }

      //@ts-ignore
      await telegramBotService.sendPaymentNotification(payment.shopId, payment, telegramStatus as any);

      console.log(`✅ Telegram notification sent successfully for payment ${payment.id}`);

    } catch (error) {
      console.error('Failed to send Telegram payment notification:', error);
    }
  }

  private async sendNotificationToShop(payment: any, status: string): Promise<void> {
    // Здесь будет логика отправки уведомлений магазину
    // Например, через Telegram бота или email
    console.log(`Notification: Payment ${payment.id} status changed to ${status}`);
  }
}
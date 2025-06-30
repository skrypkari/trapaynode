import prisma from '../config/database';
import { CreatePaymentRequest, UpdatePaymentRequest, PaymentResponse, PaymentFilters } from '../types/payment';
import { WebhookLogResponse, WebhookLogFilters } from '../types/webhook';
import { ShopProfileResponse, UpdateShopProfileRequest, GatewaySettings, UpdateWalletsRequest } from '../types/shop';
import { PayoutResponse, PayoutFilters, PayoutStatistics, PayoutStats, ShopPayoutStats, ShopPayoutResponse } from '../types/payout';
import { PlisioService } from './gateways/plisioService';
import { RapydService } from './gateways/rapydService';
import { NodaService } from './gateways/nodaService';
import { CoinToPayService } from './gateways/coinToPayService';
import { KlymeService } from './gateways/klymeService'; // ✅ ДОБАВЛЕНО
import { currencyService } from './currencyService';
import { getGatewayNameById, isValidGatewayId, getKlymeRegionFromGatewayName } from '../types/gateway';

export class ShopService {
  private plisioService: PlisioService;
  private rapydService: RapydService;
  private nodaService: NodaService;
  private coinToPayService: CoinToPayService;
  private klymeService: KlymeService; // ✅ ДОБАВЛЕНО

  constructor() {
    this.plisioService = new PlisioService();
    this.rapydService = new RapydService();
    this.nodaService = new NodaService();
    this.coinToPayService = new CoinToPayService();
    this.klymeService = new KlymeService(); // ✅ ДОБАВЛЕНО
  }

  // Helper method to generate gateway order ID in format xxxxxxxx-xxxxxxxx (8digits-8digits) for ALL gateways with uniqueness check
  private async generateGatewayOrderId(): Promise<string> {
    let gatewayOrderId: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      const generateSegment = () => {
        return Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
      };
      
      gatewayOrderId = `${generateSegment()}-${generateSegment()}`;
      
      // Check if this order ID already exists
      const existingPayment = await prisma.payment.findFirst({
        where: { gatewayOrderId },
      });

      if (!existingPayment) {
        break; // Unique ID found
      }

      attempts++;
      console.log(`⚠️ Gateway order ID ${gatewayOrderId} already exists, generating new one (attempt ${attempts})`);
      
    } while (attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      throw new Error('Failed to generate unique gateway order ID after maximum attempts');
    }

    return gatewayOrderId;
  }

  // ✅ НОВЫЙ: Helper method to generate gateway-specific URLs
  private generateGatewayUrls(gatewayName: string, orderId: string, baseUrl: string, successUrl?: string, failUrl?: string): {
    finalSuccessUrl: string;
    finalFailUrl: string;
  } {
    // If merchant provided custom URLs, use them
    if (successUrl && failUrl) {
      return {
        finalSuccessUrl: successUrl,
        finalFailUrl: failUrl,
      };
    }

    // Generate default URLs based on gateway
    let finalSuccessUrl: string;
    let finalFailUrl: string;

    if (gatewayName === 'noda' || gatewayName.startsWith('klyme_') || gatewayName === 'cointopay') {
      // ✅ Для Noda и KLYME: /payment/pending после успешной оплаты
      finalSuccessUrl = successUrl || `${baseUrl}/payment/pending?id=${orderId}`;
    } else {
      // ✅ Для остальных шлюзов: /payment/success после успешной оплаты
      finalSuccessUrl = successUrl || `${baseUrl}/payment/success?id=${orderId}`;
    }

    // ✅ Для всех шлюзов: /payment/fail при неудаче
    finalFailUrl = failUrl || `${baseUrl}/payment/failed?id=${orderId}`;

    console.log(`🔗 Generated URLs for ${gatewayName}:`);
    console.log(`   ✅ Success: ${finalSuccessUrl}`);
    console.log(`   ❌ Fail: ${finalFailUrl}`);

    return { finalSuccessUrl, finalFailUrl };
  }

  // Helper method to get gateway-specific settings
  private getGatewaySettings(shop: any, gateway: string): { commission: number; payoutDelay: number } {
    const gatewaySettings = shop.gatewaySettings ? JSON.parse(shop.gatewaySettings) : null;
    const gatewayName = gateway.charAt(0).toUpperCase() + gateway.slice(1).toLowerCase(); // Capitalize first letter
    
    if (gatewaySettings && gatewaySettings[gatewayName]) {
      return {
        commission: gatewaySettings[gatewayName].commission,
        payoutDelay: gatewaySettings[gatewayName].payoutDelay,
      };
    }
    
    // Fallback to default settings
    return {
      commission: 0, // Default commission if no gateway-specific settings
      payoutDelay: 0, // Default payout delay if no gateway-specific settings
    };
  }

  // Helper method to check if payment is eligible for payout
  private isEligibleForPayout(payment: any, gatewaySettings: { commission: number; payoutDelay: number }): boolean {
    if (payment.status !== 'PAID' || payment.merchantPaid || !payment.paidAt) {
      return false;
    }

    const payoutDelayMs = gatewaySettings.payoutDelay * 24 * 60 * 60 * 1000; // Convert days to milliseconds
    const eligibleDate = new Date(payment.paidAt.getTime() + payoutDelayMs);
    
    return new Date() > eligibleDate;
  }

  // Helper method to calculate amount after commission
  private calculateAmountAfterCommission(amount: number, commission: number): number {
    return amount * (1 - commission / 100);
  }

  // Shop profile management
  async getShopProfile(shopId: string): Promise<ShopProfileResponse> {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        id: true,
        name: true,
        username: true,
        telegram: true,
        shopUrl: true,
        paymentGateways: true,
        gatewaySettings: true,
        publicKey: true,
        // Wallet fields
        usdtPolygonWallet: true,
        usdtTrcWallet: true,
        usdtErcWallet: true,
        usdcPolygonWallet: true,
        status: true,
        createdAt: true,
      },
    });

    if (!shop) {
      throw new Error('Shop not found');
    }

    return {
      id: shop.id,
      fullName: shop.name,
      username: shop.username,
      telegramId: shop.telegram,
      merchantUrl: shop.shopUrl,
      gateways: shop.paymentGateways ? JSON.parse(shop.paymentGateways) : null,
      gatewaySettings: shop.gatewaySettings ? JSON.parse(shop.gatewaySettings) : null,
      publicKey: shop.publicKey,
      // Wallet fields
      wallets: {
        usdtPolygonWallet: shop.usdtPolygonWallet,
        usdtTrcWallet: shop.usdtTrcWallet,
        usdtErcWallet: shop.usdtErcWallet,
        usdcPolygonWallet: shop.usdcPolygonWallet,
      },
      status: shop.status,
      createdAt: shop.createdAt,
    };
  }

  async updateShopProfile(shopId: string, updateData: UpdateShopProfileRequest): Promise<ShopProfileResponse> {
    const updatePayload: any = { ...updateData };

    // Handle field name mappings
    if (updateData.fullName) {
      updatePayload.name = updateData.fullName;
      delete updatePayload.fullName;
    }

    if (updateData.telegramId) {
      updatePayload.telegram = updateData.telegramId;
      delete updatePayload.telegramId;
    }

    // Handle merchant URL
    if (updateData.merchantUrl) {
      updatePayload.shopUrl = updateData.merchantUrl;
      delete updatePayload.merchantUrl;
    }

    // Handle gateways
    if (updateData.gateways) {
      updatePayload.paymentGateways = JSON.stringify(updateData.gateways);
      delete updatePayload.gateways;
    }

    // Handle gateway settings
    if (updateData.gatewaySettings) {
      updatePayload.gatewaySettings = JSON.stringify(updateData.gatewaySettings);
      delete updatePayload.gatewaySettings;
    }

    // Handle wallet fields
    if (updateData.wallets) {
      if (updateData.wallets.usdtPolygonWallet !== undefined) {
        updatePayload.usdtPolygonWallet = updateData.wallets.usdtPolygonWallet || null;
      }
      if (updateData.wallets.usdtTrcWallet !== undefined) {
        updatePayload.usdtTrcWallet = updateData.wallets.usdtTrcWallet || null;
      }
      if (updateData.wallets.usdtErcWallet !== undefined) {
        updatePayload.usdtErcWallet = updateData.wallets.usdtErcWallet || null;
      }
      if (updateData.wallets.usdcPolygonWallet !== undefined) {
        updatePayload.usdcPolygonWallet = updateData.wallets.usdcPolygonWallet || null;
      }
      delete updatePayload.wallets;
    }

    const updatedShop = await prisma.shop.update({
      where: { id: shopId },
      data: updatePayload,
      select: {
        id: true,
        name: true,
        username: true,
        telegram: true,
        shopUrl: true,
        paymentGateways: true,
        gatewaySettings: true,
        publicKey: true,
        // Wallet fields
        usdtPolygonWallet: true,
        usdtTrcWallet: true,
        usdtErcWallet: true,
        usdcPolygonWallet: true,
        status: true,
        createdAt: true,
      },
    });

    return {
      id: updatedShop.id,
      fullName: updatedShop.name,
      username: updatedShop.username,
      telegramId: updatedShop.telegram,
      merchantUrl: updatedShop.shopUrl,
      gateways: updatedShop.paymentGateways ? JSON.parse(updatedShop.paymentGateways) : null,
      gatewaySettings: updatedShop.gatewaySettings ? JSON.parse(updatedShop.gatewaySettings) : null,
      publicKey: updatedShop.publicKey,
      // Wallet fields
      wallets: {
        usdtPolygonWallet: updatedShop.usdtPolygonWallet,
        usdtTrcWallet: updatedShop.usdtTrcWallet,
        usdtErcWallet: updatedShop.usdtErcWallet,
        usdcPolygonWallet: updatedShop.usdcPolygonWallet,
      },
      status: updatedShop.status,
      createdAt: updatedShop.createdAt,
    };
  }

  // New method to update only wallet settings
  async updateWallets(shopId: string, walletData: UpdateWalletsRequest): Promise<void> {
    const updatePayload: any = {};

    if (walletData.usdtPolygonWallet !== undefined) {
      updatePayload.usdtPolygonWallet = walletData.usdtPolygonWallet || null;
    }
    if (walletData.usdtTrcWallet !== undefined) {
      updatePayload.usdtTrcWallet = walletData.usdtTrcWallet || null;
    }
    if (walletData.usdtErcWallet !== undefined) {
      updatePayload.usdtErcWallet = walletData.usdtErcWallet || null;
    }
    if (walletData.usdcPolygonWallet !== undefined) {
      updatePayload.usdcPolygonWallet = walletData.usdcPolygonWallet || null;
    }

    await prisma.shop.update({
      where: { id: shopId },
      data: updatePayload,
    });
  }

  // New method to test webhook
  async testWebhook(shopId: string): Promise<{
    webhookUrl: string | null;
    statusCode: number;
    responseTime: number;
    success: boolean;
    error?: string;
  }> {
    // Get shop settings to find webhook URL
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
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
    });

    if (!shop) {
      throw new Error('Shop not found');
    }

    const webhookUrl = shop.settings?.webhookUrl;
    
    if (!webhookUrl) {
      throw new Error('No webhook URL configured. Please set up your webhook URL in settings first.');
    }

    // Create test webhook payload
    const testGatewayOrderId = await this.generateGatewayOrderId();
    const testPayload = {
      event: 'payment.success',
      payment: {
        id: 'test_payment_' + Date.now(),
        order_id: null, // Merchant order ID (null for test)
        gateway_order_id: testGatewayOrderId, // Gateway order ID
        gateway: 'plisio',
        amount: 100,
        currency: 'USD',
        status: 'paid',
        customer_email: 'test@example.com',
        customer_name: 'Test Customer',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      test: true, // Indicate this is a test webhook
      shop: {
        id: shop.id,
        name: shop.name,
      },
      timestamp: new Date().toISOString(),
    };

    const startTime = Date.now();
    let statusCode = 0;
    let success = false;
    let error: string | undefined;

    try {
      console.log(`🧪 Sending test webhook to: ${webhookUrl}`);
      console.log('Test payload:', JSON.stringify(testPayload, null, 2));

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TesSoft Payment System/1.0 (Test Webhook)',
          'X-Webhook-Test': 'true',
        },
        body: JSON.stringify(testPayload),
      });

      statusCode = response.status;
      success = response.ok;

      if (!response.ok) {
        const responseText = await response.text();
        error = `HTTP ${response.status}: ${responseText}`;
        console.error(`❌ Test webhook failed: ${error}`);
      } else {
        console.log(`✅ Test webhook sent successfully: ${response.status}`);
      }

    } catch (fetchError) {
      error = fetchError instanceof Error ? fetchError.message : 'Unknown error';
      console.error(`❌ Test webhook error: ${error}`);
    }

    const responseTime = Date.now() - startTime;

    // Log the test webhook attempt
    try {
      await prisma.webhookLog.create({
        data: {
          paymentId: 'test_webhook',
          shopId: shop.id,
          event: 'test_webhook',
          statusCode: statusCode,
          responseBody: JSON.stringify({
            success,
            error,
            responseTime,
            testPayload,
          }),
        },
      });
    } catch (logError) {
      console.error('Failed to log test webhook:', logError);
    }

    return {
      webhookUrl,
      statusCode,
      responseTime,
      success,
      error,
    };
  }

  // Payment management
  async createPayment(paymentData: CreatePaymentRequest): Promise<PaymentResponse> {
    // Validate and convert gateway ID to name if needed
    let gatewayName: string;
    
    if (isValidGatewayId(paymentData.gateway)) {
      // It's a gateway ID, convert to name
      const convertedName = getGatewayNameById(paymentData.gateway);
      if (!convertedName) {
        throw new Error(`Gateway not found for ID: ${paymentData.gateway}`);
      }
      gatewayName = convertedName;
    } else {
      // It's already a gateway name
      gatewayName = paymentData.gateway.toLowerCase();
    }

    console.log(`🔄 Creating shop payment for gateway: ${gatewayName}`);

    // ALWAYS generate gateway order ID in format xxxxxxxx-xxxxxxxx for ALL gateways with uniqueness check
    const gatewayOrderId = await this.generateGatewayOrderId();
    console.log(`🎯 Generated unique gateway order_id: ${gatewayOrderId} (8digits-8digits format for ${gatewayName})`);

    // Get shop information including gateway settings
    const shop = await prisma.shop.findUnique({
      where: { id: paymentData.shopId },
      select: {
        id: true,
        name: true,
        username: true,
        gatewaySettings: true,
      },
    });

    if (!shop) {
      throw new Error('Shop not found');
    }

    // Get gateway-specific settings
    const gatewayConfig = this.getGatewaySettings(shop, gatewayName);

    // ✅ ИСПРАВЛЕНО: Generate gateway-specific URLs
    const baseUrl = process.env.BASE_URL || 'https://tesoft.uk';
    const { finalSuccessUrl, finalFailUrl } = this.generateGatewayUrls(
      gatewayName, 
      gatewayOrderId, 
      baseUrl, 
      paymentData.redirectUrl, // Use redirectUrl as successUrl
      undefined // No custom failUrl for shop payments
    );

    // Create payment in database first
    const payment = await prisma.payment.create({
      data: {
        shopId: paymentData.shopId,
        gateway: gatewayName, // Store gateway name in database
        amount: paymentData.amount,
        currency: paymentData.currency || 'USD',
        sourceCurrency: paymentData.sourceCurrency || null,
        usage: paymentData.usage || 'ONCE',
        expiresAt: paymentData.expiresAt,
        successUrl: finalSuccessUrl,
        failUrl: finalFailUrl,
        status: 'PENDING',
        orderId: null, // No merchant order ID for shop-created payments
        gatewayOrderId: gatewayOrderId, // Store gateway order ID
        customerEmail: paymentData.customerEmail || null,
        customerName: paymentData.customerName || null,
        // New Rapyd fields
        country: paymentData.country || null,
        language: paymentData.language || null,
        amountIsEditable: paymentData.amountIsEditable || null,
        maxPayments: paymentData.maxPayments || null,
        rapydCustomer: paymentData.customer || null,
      },
      include: {
        shop: {
          select: {
            name: true,
            username: true,
          },
        },
      },
    });

    console.log(`💾 Shop payment created with gateway order_id: ${gatewayOrderId} (8digits-8digits format)`);

    let externalPaymentUrl: string | undefined; // Original gateway URL

    // Process payment through gateway if needed
    try {
      if (gatewayName === 'plisio') {
        // Apply Plisio-specific logic for currency handling
        let plisioCurrency: string;
        let plisioSourceCurrency: string;
        let isSourceCurrency: boolean;

        if (paymentData.sourceCurrency) {
          // Shop specified both currency and sourceCurrency - use Plisio mapping
          plisioCurrency = paymentData.sourceCurrency; // What user pays with (crypto)
          plisioSourceCurrency = paymentData.currency || 'USD'; // What shop receives (fiat)
          isSourceCurrency = false; // User is specifying target currency
        } else {
          // Shop only specified currency - treat as source currency (what they want to receive)
          plisioCurrency = 'USD'; // Default target currency
          plisioSourceCurrency = paymentData.currency || 'USD'; // What shop receives
          isSourceCurrency = true; // Shop is specifying source currency
        }

        const plisioResult = await this.plisioService.createPayment({
          paymentId: payment.id,
          orderId: gatewayOrderId, // Send gateway order ID to Plisio
          amount: paymentData.amount,
          currency: plisioCurrency,
          productName: `Order ID: ${gatewayOrderId}`, // Use gateway order ID
          description: `Order ID: ${gatewayOrderId}`, // Use gateway order ID
          successUrl: finalSuccessUrl,
          failUrl: finalFailUrl,
          customerEmail: paymentData.customerEmail,
          customerName: paymentData.customerName,
          isSourceCurrency: isSourceCurrency,
        });

        externalPaymentUrl = plisioResult.payment_url; // Store original Plisio URL

        // Update payment with gateway information
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            externalPaymentUrl: externalPaymentUrl, // Store original Plisio URL
            gatewayPaymentId: plisioResult.gateway_payment_id,
            invoiceTotalSum: Number(plisioResult.invoice_total_sum),
            qrCode: plisioResult.qr_code,
            qrUrl: plisioResult.qr_url,
          },
        });

        // Update the payment object for response
        payment.externalPaymentUrl = externalPaymentUrl;
        payment.gatewayPaymentId = plisioResult.gateway_payment_id;
      } else if (gatewayName === 'rapyd') {
        // ✅ ИСПРАВЛЕНО: Всегда используем GB для Rapyd
        const rapydCountry = 'GB'; // Всегда Британия
        console.log(`🇬🇧 Using GB (Britain) as country for Rapyd shop payment`);

        const rapydResult = await this.rapydService.createPaymentLink({
          paymentId: payment.id,
          orderId: gatewayOrderId, // Send gateway order ID to Rapyd
          orderName: `Order ID: ${gatewayOrderId}`, // Use gateway order ID
          amount: paymentData.amount,
          currency: paymentData.currency || 'USD',
          country: rapydCountry, // ✅ Всегда GB
          usage: paymentData.usage || 'ONCE',
          maxPayments: paymentData.maxPayments,
          successUrl: finalSuccessUrl,
          failUrl: finalFailUrl,
        });

        externalPaymentUrl = rapydResult.payment_url; // Store original Rapyd URL

        // Update payment with gateway information
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            externalPaymentUrl: externalPaymentUrl, // Store original Rapyd URL
            gatewayPaymentId: rapydResult.gateway_payment_id,
            country: rapydCountry, // Store GB in database
          },
        });

        // Update the payment object for response
        payment.externalPaymentUrl = externalPaymentUrl;
        payment.gatewayPaymentId = rapydResult.gateway_payment_id;
      } else if (gatewayName === 'noda') {
        console.log(`🔄 Creating Noda shop payment with gateway order_id: ${gatewayOrderId} (8digits-8digits format)`);

        const nodaResult = await this.nodaService.createPaymentLink({
          paymentId: payment.id,
          orderId: gatewayOrderId, // Send gateway order ID to Noda
          name: `Order ID: ${gatewayOrderId}`, // Use gateway order ID
          paymentDescription: `Order ID: ${gatewayOrderId}`, // Use gateway order ID
          amount: paymentData.amount,
          currency: paymentData.currency || 'USD',
          webhookUrl: `https://tesoft.uk/gateways/noda/webhook`,
          returnUrl: finalSuccessUrl,
          expiryDate: paymentData.expiresAt?.toISOString(),
        });

        externalPaymentUrl = nodaResult.payment_url; // Store original Noda URL

        // Update payment with gateway information
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            externalPaymentUrl: externalPaymentUrl, // Store original Noda URL
            gatewayPaymentId: nodaResult.gateway_payment_id,
            qrUrl: nodaResult.qr_code_url,
          },
        });

        // Update the payment object for response
        payment.externalPaymentUrl = externalPaymentUrl;
        payment.gatewayPaymentId = nodaResult.gateway_payment_id;

        console.log(`✅ Noda shop payment created successfully with gateway order_id: ${gatewayOrderId}`);
      } else if (gatewayName === 'cointopay') {
        console.log(`🪙 Creating CoinToPay shop payment with gateway order_id: ${gatewayOrderId} (8digits-8digits format)`);
        console.log(`💰 Amount: ${paymentData.amount} EUR (always EUR for CoinToPay)`);

        const coinToPayResult = await this.coinToPayService.createPaymentLink({
          paymentId: payment.id,
          orderId: gatewayOrderId, // Send gateway order ID to CoinToPay
          amount: paymentData.amount, // Only amount needed, always in EUR
        });

        externalPaymentUrl = coinToPayResult.payment_url; // Store original CoinToPay URL

        // Update payment with gateway information
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            externalPaymentUrl: externalPaymentUrl, // Store original CoinToPay URL
            gatewayPaymentId: coinToPayResult.gateway_payment_id,
            currency: 'EUR', // ✅ Force EUR for CoinToPay
          },
        });

        // Update the payment object for response
        payment.externalPaymentUrl = externalPaymentUrl;
        payment.gatewayPaymentId = coinToPayResult.gateway_payment_id;

        console.log(`✅ CoinToPay shop payment created successfully with gateway order_id: ${gatewayOrderId}`);
      } else if (gatewayName.startsWith('klyme_')) {
        // ✅ ДОБАВЛЕНО: KLYME integration for shop payments
        const region = getKlymeRegionFromGatewayName(gatewayName);
        
        if (!region) {
          throw new Error(`Invalid KLYME gateway: ${gatewayName}`);
        }

        if (region !== 'EU' && region !== 'GB') {
          throw new Error(`KLYME payment creation is only supported for EU and GB regions, got: ${region}`);
        }

        console.log(`💳 Creating KLYME ${region} shop payment with gateway order_id: ${gatewayOrderId} (8digits-8digits format)`);
        console.log(`💰 Amount: ${paymentData.amount} ${paymentData.currency || 'USD'}`);

        const klymeResult = await this.klymeService.createPaymentLink({
          paymentId: payment.id,
          orderId: gatewayOrderId, // Send gateway order ID to KLYME (will be used as reference)
          amount: paymentData.amount,
          currency: paymentData.currency || 'USD',
          region,
          redirectUrl: finalSuccessUrl, // KLYME will use this for redirect
        });

        externalPaymentUrl = klymeResult.payment_url; // Store original KLYME URL

        // Update payment with gateway information
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            externalPaymentUrl: externalPaymentUrl, // Store original KLYME URL
            gatewayPaymentId: klymeResult.gateway_payment_id,
          },
        });

        // Update the payment object for response
        payment.externalPaymentUrl = externalPaymentUrl;
        payment.gatewayPaymentId = klymeResult.gateway_payment_id;

        console.log(`✅ KLYME ${region} shop payment created successfully with gateway order_id: ${gatewayOrderId}`);
      }
    } catch (gatewayError) {
      // If gateway fails, update payment status to failed
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
      
      console.error('Gateway error during shop payment creation:', gatewayError);
      // Continue with payment creation even if gateway fails
    }

    // ✅ Return tesoft.uk/gateway/payment.php?id= URL instead of external gateway URL
    const paymentUrl = `https://tesoft.uk/gateway/payment.php?id=${payment.id}`;

    return {
      id: payment.id,
      shopId: payment.shopId,
      gateway: payment.gateway,
      amount: payment.amount,
      currency: payment.currency,
      sourceCurrency: payment.sourceCurrency,
      usage: payment.usage,
      expiresAt: payment.expiresAt,
      redirectUrl: paymentUrl, // ✅ Return tesoft.uk/gateway/payment.php?id= URL
      status: payment.status,
      externalPaymentUrl: externalPaymentUrl, // Original gateway URL (for internal use)
      customerEmail: payment.customerEmail,
      customerName: payment.customerName,
      // New Rapyd fields
      country: payment.country,
      language: payment.language,
      amountIsEditable: payment.amountIsEditable,
      maxPayments: payment.maxPayments,
      customer: payment.rapydCustomer,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      shop: payment.shop,
    };
  }

  async getPayments(shopId: string, filters: PaymentFilters): Promise<{
    payments: PaymentResponse[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const { page, limit, status, gateway } = filters;
    const skip = (page - 1) * limit;

    const where: any = { shopId };
    
    if (status) {
      where.status = status;
    }
    
    if (gateway) {
      // If gateway filter is provided, check if it's an ID or name
      if (isValidGatewayId(gateway)) {
        // It's a gateway ID, convert to name
        const gatewayName = getGatewayNameById(gateway);
        if (gatewayName) {
          where.gateway = gatewayName;
        }
      } else {
        // It's a gateway name
        where.gateway = gateway.toLowerCase();
      }
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          shop: {
            select: {
              name: true,
              username: true,
            },
          },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      payments: payments.map(payment => {
        // ✅ Return tesoft.uk/gateway/payment.php?id= URL instead of external gateway URL
        const paymentUrl = `https://tesoft.uk/gateway/payment.php?id=${payment.id}`;

        return {
          id: payment.id,
          shopId: payment.shopId,
          gateway: payment.gateway,
          amount: payment.amount,
          currency: payment.currency,
          sourceCurrency: payment.sourceCurrency,
          usage: payment.usage,
          expiresAt: payment.expiresAt,
          redirectUrl: paymentUrl, // ✅ Return tesoft.uk/gateway/payment.php?id= URL
          status: payment.status,
          externalPaymentUrl: payment.externalPaymentUrl, // Original gateway URL (for internal use)
          customerEmail: payment.customerEmail,
          customerName: payment.customerName,
          // New Rapyd fields
          country: payment.country,
          language: payment.language,
          amountIsEditable: payment.amountIsEditable,
          maxPayments: payment.maxPayments,
          customer: payment.rapydCustomer,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
          shop: payment.shop,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPaymentById(shopId: string, paymentId: string): Promise<PaymentResponse | null> {
    const payment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        shopId,
      },
      include: {
        shop: {
          select: {
            name: true,
            username: true,
          },
        },
        webhookLogs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!payment) return null;

    // ✅ Return tesoft.uk/gateway/payment.php?id= URL instead of external gateway URL
    const paymentUrl = `https://tesoft.uk/gateway/payment.php?id=${payment.id}`;

    return {
      id: payment.id,
      shopId: payment.shopId,
      gateway: payment.gateway,
      amount: payment.amount,
      currency: payment.currency,
      sourceCurrency: payment.sourceCurrency,
      usage: payment.usage,
      expiresAt: payment.expiresAt,
      redirectUrl: paymentUrl, // ✅ Return tesoft.uk/gateway/payment.php?id= URL
      status: payment.status,
      externalPaymentUrl: payment.externalPaymentUrl, // Original gateway URL (for internal use)
      customerEmail: payment.customerEmail,
      customerName: payment.customerName,
      // New Rapyd fields
      country: payment.country,
      language: payment.language,
      amountIsEditable: payment.amountIsEditable,
      maxPayments: payment.maxPayments,
      customer: payment.rapydCustomer,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      shop: payment.shop,
      webhookLogs: payment.webhookLogs,
    };
  }

  async updatePayment(shopId: string, paymentId: string, updateData: UpdatePaymentRequest): Promise<PaymentResponse> {
    // Handle gateway ID to name conversion if needed
    const updatePayload: any = { ...updateData };
    
    if (updateData.gateway) {
      if (isValidGatewayId(updateData.gateway)) {
        // It's a gateway ID, convert to name
        const gatewayName = getGatewayNameById(updateData.gateway);
        if (gatewayName) {
          updatePayload.gateway = gatewayName;
        }
      } else {
        // It's already a gateway name
        updatePayload.gateway = updateData.gateway.toLowerCase();
      }
    }

    const payment = await prisma.payment.update({
      where: {
        id: paymentId,
        shopId,
      },
      data: updatePayload,
      include: {
        shop: {
          select: {
            name: true,
            username: true,
          },
        },
      },
    });

    // ✅ Return tesoft.uk/gateway/payment.php?id= URL instead of external gateway URL
    const paymentUrl = `https://tesoft.uk/gateway/payment.php?id=${payment.id}`;

    return {
      id: payment.id,
      shopId: payment.shopId,
      gateway: payment.gateway,
      amount: payment.amount,
      currency: payment.currency,
      sourceCurrency: payment.sourceCurrency,
      usage: payment.usage,
      expiresAt: payment.expiresAt,
      redirectUrl: paymentUrl, // ✅ Return tesoft.uk/gateway/payment.php?id= URL
      status: payment.status,
      externalPaymentUrl: payment.externalPaymentUrl, // Original gateway URL (for internal use)
      customerEmail: payment.customerEmail,
      customerName: payment.customerName,
      // New Rapyd fields
      country: payment.country,
      language: payment.language,
      amountIsEditable: payment.amountIsEditable,
      maxPayments: payment.maxPayments,
      customer: payment.rapydCustomer,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      shop: payment.shop,
    };
  }

  async deletePayment(shopId: string, paymentId: string): Promise<void> {
    await prisma.payment.delete({
      where: {
        id: paymentId,
        shopId,
      },
    });
  }

  // Payout management - Updated to return shop payout stats
  async getPayouts(shopId: string, filters: PayoutFilters): Promise<{
    payouts: ShopPayoutResponse[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const { page, limit, status, method, dateFrom, dateTo } = filters;
    const skip = (page - 1) * limit;

    const where: any = { shopId };
    
    if (status) {
      where.status = status;
    }
    
    if (method) {
      where.network = method; // Use network field instead of method
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.createdAt.lte = new Date(dateTo);
      }
    }

    const [payouts, total] = await Promise.all([
      prisma.payout.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payout.count({ where }),
    ]);

    return {
      payouts: payouts.map(payout => ({
        id: payout.id,
        amount: payout.amount,
        network: payout.network,
        status: payout.status,
        txid: payout.txid,
        notes: payout.notes,
        createdAt: payout.createdAt,
        paidAt: payout.paidAt!,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPayoutById(shopId: string, payoutId: string): Promise<PayoutResponse | null> {
    const payout = await prisma.payout.findFirst({
      where: {
        id: payoutId,
        shopId,
      },
      include: {
        shop: {
          select: {
            name: true,
            username: true,
          },
        },
      },
    });

    if (!payout) return null;

    return {
      id: payout.id,
      shopId: payout.shopId,
      amount: payout.amount,
      method: payout.network, // Map network to method for compatibility
      status: payout.status,
      txid: payout.txid,
      createdAt: payout.createdAt,
      paidAt: payout.paidAt,
      shop: payout.shop,
    };
  }

  async getPayoutStatistics(shopId: string, period: string): Promise<PayoutStatistics> {
    const periodDays = this.getPeriodDays(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const where = {
      shopId,
      createdAt: {
        gte: startDate,
      },
    };

    const [
      totalPayouts,
      completedPayouts,
      pendingPayouts,
      rejectedPayouts,
      payoutStats,
      payoutsByStatus,
      payoutsByMethod,
      recentPayouts,
    ] = await Promise.all([
      prisma.payout.count({ where }),
      prisma.payout.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.payout.count({ where: { ...where, status: 'PENDING' } }),
      prisma.payout.count({ where: { ...where, status: 'REJECTED' } }),
      prisma.payout.aggregate({
        where,
        _sum: { amount: true },
      }),
      prisma.payout.groupBy({
        by: ['status'],
        where,
        _count: { status: true },
      }),
      prisma.payout.groupBy({
        by: ['network'], // Use network instead of method
        where,
        _count: { network: true },
      }),
      prisma.payout.findMany({
        where: { shopId },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          shop: {
            select: {
              name: true,
              username: true,
            },
          },
        },
      }),
    ]);

    // Calculate amounts by status
    const completedAmount = await prisma.payout.aggregate({
      where: { ...where, status: 'COMPLETED' },
      _sum: { amount: true },
    });

    const pendingAmount = await prisma.payout.aggregate({
      where: { ...where, status: 'PENDING' },
      _sum: { amount: true },
    });

    return {
      totalPayouts,
      completedPayouts,
      pendingPayouts,
      rejectedPayouts,
      totalAmount: payoutStats._sum.amount || 0,
      completedAmount: completedAmount._sum.amount || 0,
      pendingAmount: pendingAmount._sum.amount || 0,
      payoutsByStatus: payoutsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count.status;
        return acc;
      }, {} as Record<string, number>),
      payoutsByMethod: payoutsByMethod.reduce((acc, item) => {
        acc[item.network] = item._count.network; // Use network
        return acc;
      }, {} as Record<string, number>),
      recentPayouts: recentPayouts.map(payout => ({
        id: payout.id,
        shopId: payout.shopId,
        amount: payout.amount,
        method: payout.network, // Map network to method
        status: payout.status,
        txid: payout.txid,
        createdAt: payout.createdAt,
        paidAt: payout.paidAt,
        shop: payout.shop,
      })),
    };
  }

  // New method for shop payout stats with specific structure
  async getShopPayoutStats(shopId: string): Promise<ShopPayoutStats> {
    console.log(`📊 Calculating shop payout stats for shop: ${shopId}`);

    // Get shop with gateway settings
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        id: true,
        gatewaySettings: true,
      },
    });

    if (!shop) {
      throw new Error('Shop not found');
    }

    // Get all paid payments for this shop
    const allPaidPayments = await prisma.payment.findMany({
      where: {
        shopId,
        status: 'PAID',
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        gateway: true,
        paidAt: true,
        merchantPaid: true,
        createdAt: true,
      },
    });

    console.log(`💰 Found ${allPaidPayments.length} paid payments for analysis`);

    // Calculate current month boundaries
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let totalPaidOutUSDT = 0;
    let awaitingPayoutUSDT = 0;
    let thisMonthUSDT = 0;
    let availableBalanceUSDT = 0;

    // Process each payment
    for (const payment of allPaidPayments) {
      // Convert amount to USDT
      const amountUSDT = await currencyService.convertToUSDT(payment.amount, payment.currency);
      
      // Get gateway-specific settings
      const gatewayConfig = this.getGatewaySettings(shop, payment.gateway);
      const amountAfterCommission = this.calculateAmountAfterCommission(amountUSDT, gatewayConfig.commission);

      // Total Paid Out: все выплаченные мерчанту транзакции (merchant_paid = true)
      if (payment.merchantPaid) {
        totalPaidOutUSDT += amountAfterCommission;

        // This Month: выплаты в текущем месяце
        if (payment.paidAt && payment.paidAt >= startOfMonth) {
          thisMonthUSDT += amountAfterCommission;
        }
      }

      // Awaiting Payout: eligible for payout (не выплачено + прошла задержка)
      if (this.isEligibleForPayout(payment, gatewayConfig)) {
        awaitingPayoutUSDT += amountAfterCommission;
        availableBalanceUSDT += amountUSDT; // Без вычета комиссии для Available Balance
      }
    }

    const stats: ShopPayoutStats = {
      availableBalance: Math.round(availableBalanceUSDT * 100) / 100,
      totalPaidOut: Math.round(totalPaidOutUSDT * 100) / 100,
      awaitingPayout: Math.round(awaitingPayoutUSDT * 100) / 100,
      thisMonth: Math.round(thisMonthUSDT * 100) / 100,
    };

    console.log('✅ Shop payout statistics calculated:');
    console.log(`💰 Available Balance: ${stats.availableBalance} USDT`);
    console.log(`💸 Total Paid Out: ${stats.totalPaidOut} USDT`);
    console.log(`⏳ Awaiting Payout: ${stats.awaitingPayout} USDT`);
    console.log(`📅 This Month: ${stats.thisMonth} USDT`);

    return stats;
  }

  // Legacy method for backward compatibility
  async getPayoutStats(shopId: string): Promise<PayoutStats> {
    const shopStats = await this.getShopPayoutStats(shopId);
    
    return {
      totalBalance: shopStats.availableBalance,
      totalPaidOut: shopStats.totalPaidOut,
      awaitingPayout: shopStats.awaitingPayout,
      thisMonth: shopStats.thisMonth,
    };
  }

  // Webhook logs
  async getWebhookLogs(shopId: string, filters: WebhookLogFilters): Promise<{
    logs: WebhookLogResponse[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const { page, limit, paymentId } = filters;
    const skip = (page - 1) * limit;

    const where: any = { shopId };
    
    if (paymentId) {
      where.paymentId = paymentId;
    }

    const [logs, total] = await Promise.all([
      prisma.webhookLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          payment: {
            select: {
              id: true,
              amount: true,
              currency: true,
            },
          },
        },
      }),
      prisma.webhookLog.count({ where }),
    ]);

    return {
      logs: logs.map(log => ({
        id: log.id,
        paymentId: log.paymentId,
        shopId: log.shopId,
        event: log.event,
        statusCode: log.statusCode,
        retryCount: log.retryCount,
        responseBody: log.responseBody,
        createdAt: log.createdAt,
        payment: log.payment,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Statistics with time series data and USDT conversion - FIXED totalAmount calculation
  async getStatistics(shopId: string, period: string): Promise<{
    totalPayments: number;
    successfulPayments: number;
    totalAmount: number; // Now shows only PAID payments with commission deducted in USDT
    averageAmount: number; // Now in USDT
    paymentsByStatus: Record<string, number>;
    paymentsByGateway: Record<string, number>;
    recentPayments: PaymentResponse[];
    dailyRevenue: Array<{ date: string; amount: number }>; // Now in USDT
    dailyPayments: Array<{ date: string; count: number }>;
  }> {
    const periodDays = this.getPeriodDays(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    console.log(`📊 Generating shop statistics for period: ${period} (${periodDays} days)`);

    const where = {
      shopId,
      createdAt: {
        gte: startDate,
      },
    };

    // Get shop with gateway settings for commission calculation
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        id: true,
        gatewaySettings: true,
      },
    });

    if (!shop) {
      throw new Error('Shop not found');
    }

    const [
      totalPayments,
      successfulPayments,
      allPayments, // Get all payments with amounts and currencies
      paidPayments, // Get only PAID payments for totalAmount calculation
      paymentsByStatus,
      paymentsByGateway,
      recentPayments,
      dailyStats,
    ] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.count({ where: { ...where, status: 'PAID' } }),
      prisma.payment.findMany({
        where,
        select: {
          amount: true,
          currency: true,
          status: true,
        },
      }),
      // NEW: Get only PAID payments for totalAmount calculation
      prisma.payment.findMany({
        where: {
          ...where,
          status: 'PAID',
        },
        select: {
          amount: true,
          currency: true,
          gateway: true,
        },
      }),
      prisma.payment.groupBy({
        by: ['status'],
        where,
        _count: { status: true },
      }),
      prisma.payment.groupBy({
        by: ['gateway'],
        where,
        _count: { gateway: true },
      }),
      prisma.payment.findMany({
        where: { shopId },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          shop: {
            select: {
              name: true,
              username: true,
            },
          },
        },
      }),
      // Get daily statistics for time series data
      await prisma.$queryRaw`
        SELECT 
          DATE(created_at) as date,
          COUNT(*)::int as count,
          array_agg(
            json_build_object(
              'amount', amount,
              'currency', currency,
              'status', status,
              'gateway', gateway
            )
          ) as payments
        FROM payments 
        WHERE shop_id = ${shopId} 
          AND created_at >= ${startDate}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      ` as Array<{ 
        date: Date; 
        count: number; 
        payments: Array<{ amount: number; currency: string; status: string; gateway: string }> 
      }>,
    ]);

    console.log(`💰 Found ${paidPayments.length} PAID payments for totalAmount calculation`);

    // Convert only PAID payments to USDT and apply commission
    const paidPaymentsInUSDT = await Promise.all(
      paidPayments.map(async (payment) => {
        const usdtAmount = await currencyService.convertToUSDT(payment.amount, payment.currency);
        
        // Get gateway-specific commission
        const gatewayConfig = this.getGatewaySettings(shop, payment.gateway);
        const amountAfterCommission = this.calculateAmountAfterCommission(usdtAmount, gatewayConfig.commission);
        
        return amountAfterCommission;
      })
    );

    // Convert all payments to USDT for average calculation
    const allPaymentsInUSDT = await Promise.all(
      allPayments.map(async (payment) => {
        const usdtAmount = await currencyService.convertToUSDT(payment.amount, payment.currency);
        return {
          amount: usdtAmount,
          status: payment.status,
        };
      })
    );

    // Calculate totals in USDT
    const totalAmountUSDT = paidPaymentsInUSDT.reduce((sum, amount) => sum + amount, 0); // Only PAID payments with commission
    const averageAmountUSDT = totalPayments > 0 ? allPaymentsInUSDT.reduce((sum, payment) => sum + payment.amount, 0) / totalPayments : 0;

    console.log(`💵 Total amount (PAID with commission): ${totalAmountUSDT.toFixed(2)} USDT`);
    console.log(`📈 Average payment: ${averageAmountUSDT.toFixed(2)} USDT`);

    // Generate complete date range for the period
    const dateRange = this.generateDateRange(startDate, new Date());
    
    // Process daily stats and convert to USDT
    const dailyStatsProcessed = await Promise.all(
      dailyStats.map(async (stat) => {
        const dailyPaidPayments = stat.payments.filter(payment => payment.status === 'PAID');
        
        const dailyPaymentsUSDT = await Promise.all(
          dailyPaidPayments.map(async (payment) => {
            const usdtAmount = await currencyService.convertToUSDT(payment.amount, payment.currency);
            
            // Apply gateway-specific commission
            const gatewayConfig = this.getGatewaySettings(shop, payment.gateway);
            const amountAfterCommission = this.calculateAmountAfterCommission(usdtAmount, gatewayConfig.commission);
            
            return amountAfterCommission;
          })
        );

        const dailyRevenueUSDT = dailyPaymentsUSDT.reduce((sum, amount) => sum + amount, 0);

        return {
          date: stat.date.toISOString().split('T')[0],
          count: stat.count,
          revenue: dailyRevenueUSDT,
        };
      })
    );

    // Create maps for quick lookup
    const dailyStatsMap = new Map(
      dailyStatsProcessed.map(stat => [
        stat.date,
        { count: stat.count, revenue: stat.revenue }
      ])
    );

    // Fill in missing dates with zero values
    const dailyRevenue = dateRange.map(date => ({
      date,
      amount: dailyStatsMap.get(date)?.revenue || 0,
    }));

    const dailyPayments = dateRange.map(date => ({
      date,
      count: dailyStatsMap.get(date)?.count || 0,
    }));

    console.log(`✅ Shop statistics generated successfully`);
    console.log(`💳 Total payments: ${totalPayments}`);
    console.log(`✅ Successful payments: ${successfulPayments}`);
    console.log(`📊 Daily revenue entries: ${dailyRevenue.length}`);

    return {
      totalPayments,
      successfulPayments,
      totalAmount: Math.round(totalAmountUSDT * 100) / 100, // Only PAID payments with commission deducted
      averageAmount: Math.round(averageAmountUSDT * 100) / 100,
      paymentsByStatus: paymentsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count.status;
        return acc;
      }, {} as Record<string, number>),
      paymentsByGateway: paymentsByGateway.reduce((acc, item) => {
        acc[item.gateway] = item._count.gateway;
        return acc;
      }, {} as Record<string, number>),
      recentPayments: recentPayments.map(payment => {
        // ✅ Return tesoft.uk/gateway/payment.php?id= URL instead of external gateway URL
        const paymentUrl = `https://tesoft.uk/gateway/payment.php?id=${payment.id}`;

        return {
          id: payment.id,
          shopId: payment.shopId,
          gateway: payment.gateway,
          amount: payment.amount,
          currency: payment.currency,
          sourceCurrency: payment.sourceCurrency,
          usage: payment.usage,
          expiresAt: payment.expiresAt,
          redirectUrl: paymentUrl, // ✅ Return tesoft.uk/gateway/payment.php?id= URL
          status: payment.status,
          externalPaymentUrl: payment.externalPaymentUrl, // Original gateway URL (for internal use)
          customerEmail: payment.customerEmail,
          customerName: payment.customerName,
          // New Rapyd fields
          country: payment.country,
          language: payment.language,
          amountIsEditable: payment.amountIsEditable,
          maxPayments: payment.maxPayments,
          customer: payment.rapydCustomer,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
          shop: payment.shop,
        };
      }),
      dailyRevenue,
      dailyPayments,
    };
  }

  private getPeriodDays(period: string): number {
    switch (period) {
      case '7d': return 7;
      case '30d': return 30;
      case '90d': return 90;
      case '1y': return 365;
      default: return 30;
    }
  }

  private generateDateRange(startDate: Date, endDate: Date): string[] {
    const dates: string[] = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      dates.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return dates;
  }
}
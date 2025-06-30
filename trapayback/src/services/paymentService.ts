import prisma from '../config/database';
import { CreatePublicPaymentRequest, PaymentStatusResponse, PaymentFilters } from '../types/payment';
import { PlisioService } from './gateways/plisioService';
import { RapydService } from './gateways/rapydService';
import { NodaService } from './gateways/nodaService';
import { CoinToPayService } from './gateways/coinToPayService';
import { KlymeService } from './gateways/klymeService';
import { telegramBotService } from './telegramBotService';
import { coinToPayStatusService } from './coinToPayStatusService'; // ✅ ДОБАВЛЕНО
import { getGatewayNameById, isValidGatewayId, getKlymeRegionFromGatewayName } from '../types/gateway';

export class PaymentService {
  private plisioService: PlisioService;
  private rapydService: RapydService;
  private nodaService: NodaService;
  private coinToPayService: CoinToPayService;
  private klymeService: KlymeService;

  constructor() {
    this.plisioService = new PlisioService();
    this.rapydService = new RapydService();
    this.nodaService = new NodaService();
    this.coinToPayService = new CoinToPayService();
    this.klymeService = new KlymeService();
  }

  private async generateGatewayOrderId(): Promise<string> {
    let gatewayOrderId: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      const generateSegment = () => {
        return Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
      };
      
      gatewayOrderId = `${generateSegment()}-${generateSegment()}`;
      
      const existingPayment = await prisma.payment.findFirst({
        where: { gatewayOrderId },
      });

      if (!existingPayment) {
        break;
      }

      attempts++;
      console.log(`⚠️ Gateway order ID ${gatewayOrderId} already exists, generating new one (attempt ${attempts})`);
      
    } while (attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      throw new Error('Failed to generate unique gateway order ID after maximum attempts');
    }

    return gatewayOrderId;
  }

  // ✅ ИСПРАВЛЕНО: Теперь принимает paymentId вместо orderId
  private generateGatewayUrls(gatewayName: string, paymentId: string, baseUrl: string, successUrl?: string, failUrl?: string): {
    finalSuccessUrl: string;
    finalFailUrl: string;
    dbSuccessUrl: string;
    dbFailUrl: string;
  } {
    if (successUrl && failUrl) {
      return {
        finalSuccessUrl: successUrl,
        finalFailUrl: failUrl,
        dbSuccessUrl: successUrl,
        dbFailUrl: failUrl,
      };
    }

    let finalSuccessUrl: string;
    let finalFailUrl: string;
    let dbSuccessUrl: string;
    let dbFailUrl: string;

    if (gatewayName === 'noda' || gatewayName.startsWith('klyme_') || gatewayName === 'cointopay') {
      finalSuccessUrl = `${baseUrl}/gateway/pending.php?id=${paymentId}`;
      dbSuccessUrl = `https://app.trapay.uk/payment/pending?id=${paymentId}`;
    } else {
      finalSuccessUrl = `${baseUrl}/gateway/success.php?id=${paymentId}`;
      dbSuccessUrl = `https://app.trapay.uk/payment/success?id=${paymentId}`;
    }

    finalFailUrl = `${baseUrl}/gateway/fail.php?id=${paymentId}`;
    dbFailUrl = `https://app.trapay.uk/payment/fail?id=${paymentId}`;

    console.log(`🔗 Generated URLs for ${gatewayName} with payment ID ${paymentId}:`);
    console.log(`   🌐 Gateway Success URL: ${finalSuccessUrl}`);
    console.log(`   🌐 Gateway Fail URL: ${finalFailUrl}`);
    console.log(`   💾 DB Success URL: ${dbSuccessUrl}`);
    console.log(`   💾 DB Fail URL: ${dbFailUrl}`);

    return { finalSuccessUrl, finalFailUrl, dbSuccessUrl, dbFailUrl };
  }

  private validateKlymeCurrency(gatewayName: string, currency: string): void {
    if (!gatewayName.startsWith('klyme_')) return;

    const region = getKlymeRegionFromGatewayName(gatewayName);
    const upperCurrency = currency.toUpperCase();

    switch (region) {
      case 'EU':
        if (upperCurrency !== 'EUR') {
          throw new Error(`KLYME EU accepts only EUR currency, got: ${upperCurrency}`);
        }
        break;
      case 'GB':
        if (upperCurrency !== 'GBP') {
          throw new Error(`KLYME GB accepts only GBP currency, got: ${upperCurrency}`);
        }
        break;
      case 'DE':
        if (upperCurrency !== 'EUR') {
          throw new Error(`KLYME DE accepts only EUR currency, got: ${upperCurrency}`);
        }
        break;
      default:
        throw new Error(`Unsupported KLYME region: ${region}`);
    }
  }

  // ✅ ДОБАВЛЕНО: Helper method to check if gateway is allowed for shop
  private async checkGatewayPermission(shopId: string, gatewayName: string): Promise<void> {
    console.log(`🔐 Checking gateway permission for shop ${shopId}: ${gatewayName}`);

    // Get shop's configured payment gateways
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        id: true,
        name: true,
        username: true,
        paymentGateways: true,
      },
    });

    if (!shop) {
      throw new Error('Shop not found');
    }

    // Parse enabled gateways from JSON string
    let enabledGateways: string[] = [];
    
    if (shop.paymentGateways) {
      try {
        enabledGateways = JSON.parse(shop.paymentGateways);
        console.log(`🔐 Shop ${shop.username} enabled gateways:`, enabledGateways);
      } catch (error) {
        console.error('Error parsing payment gateways:', error);
        // Fallback to default gateways if parsing fails
        enabledGateways = ['Plisio'];
      }
    } else {
      // Default gateway if none configured
      enabledGateways = ['Plisio'];
      console.log(`🔐 Shop ${shop.username} using default gateways:`, enabledGateways);
    }

    // Map gateway name to display name for comparison
    const gatewayDisplayName = this.getGatewayDisplayName(gatewayName);
    
    console.log(`🔐 Checking if "${gatewayDisplayName}" is in enabled gateways:`, enabledGateways);

    // Check if the gateway is enabled for this shop
    if (!enabledGateways.includes(gatewayDisplayName)) {
      console.error(`❌ Gateway "${gatewayDisplayName}" not allowed for shop ${shop.username}`);
      console.error(`❌ Enabled gateways: ${enabledGateways.join(', ')}`);
      
      throw new Error(
        `Gateway "${gatewayDisplayName}" is not enabled for your shop. ` +
        `Enabled gateways: ${enabledGateways.join(', ')}. ` +
        `Please contact support to enable additional gateways.`
      );
    }

    console.log(`✅ Gateway "${gatewayDisplayName}" is allowed for shop ${shop.username}`);
  }

  // ✅ ДОБАВЛЕНО: Helper method to get gateway display name
  private getGatewayDisplayName(gatewayName: string): string {
    const gatewayDisplayNames: Record<string, string> = {
      'plisio': 'Plisio',
      'rapyd': 'Rapyd',
      'noda': 'Noda',
      'cointopay': 'CoinToPay',
      'klyme_eu': 'KLYME EU',
      'klyme_gb': 'KLYME GB',
      'klyme_de': 'KLYME DE',
    };

    return gatewayDisplayNames[gatewayName] || gatewayName;
  }

  async createPublicPayment(paymentData: CreatePublicPaymentRequest): Promise<{
    id: string;
    gateway_payment_id?: string;
    payment_url?: string;
    status: string;
  }> {
    const {
      public_key,
      gateway: gatewayId,
      order_id,
      amount,
      currency,
      source_currency,
      usage,
      expires_at,
      success_url,
      fail_url,
      customer_email,
      customer_name,
      country,
      language,
      amount_is_editable,
      max_payments,
      customer,
    } = paymentData;

    if (!isValidGatewayId(gatewayId)) {
      throw new Error(`Invalid gateway ID: ${gatewayId}. Valid IDs are: 0001 (Plisio), 0010 (Rapyd), 0100 (CoinToPay), 1000 (Noda), 1001 (KLYME EU), 1010 (KLYME GB), 1100 (KLYME DE)`);
    }

    const gatewayName = getGatewayNameById(gatewayId);
    if (!gatewayName) {
      throw new Error(`Gateway not found for ID: ${gatewayId}`);
    }

    console.log(`🔄 Processing payment for gateway ID ${gatewayId} (${gatewayName})`);

    this.validateKlymeCurrency(gatewayName, currency || 'USD');

    const shop = await prisma.shop.findUnique({
      where: { publicKey: public_key },
      select: {
        id: true,
        name: true,
        status: true,
        paymentGateways: true, // ✅ ДОБАВЛЕНО: Получаем настройки шлюзов
      },
    });

    if (!shop) {
      throw new Error('Invalid public key');
    }

    if (shop.status !== 'ACTIVE') {
      throw new Error('Shop is not active');
    }

    // ✅ ДОБАВЛЕНО: Проверяем разрешения на использование шлюза
    await this.checkGatewayPermission(shop.id, gatewayName);

    const gatewayOrderId = await this.generateGatewayOrderId();
    console.log(`🎯 Generated unique gateway order_id: ${gatewayOrderId} (8digits-8digits format for ${gatewayName})`);

    const merchantOrderId = order_id || null;
    console.log(`📝 Merchant order_id: ${merchantOrderId || 'not provided'}`);

    // ✅ ИСПРАВЛЕНО: Сначала создаем платеж, чтобы получить его ID
    const payment = await prisma.payment.create({
      data: {
        shopId: shop.id,
        gateway: gatewayName,
        amount,
        currency: currency || 'USD',
        sourceCurrency: source_currency || null,
        usage: usage || 'ONCE',
        expiresAt: expires_at ? new Date(expires_at) : null,
        // ✅ ВРЕМЕННО: Устанавливаем временные URL, обновим их после генерации
        successUrl: 'temp',
        failUrl: 'temp',
        status: 'PENDING',
        orderId: merchantOrderId,
        gatewayOrderId: gatewayOrderId,
        customerEmail: customer_email || null,
        customerName: customer_name || null,
        country: country || null,
        language: language || null,
        amountIsEditable: amount_is_editable || null,
        maxPayments: max_payments || null,
        rapydCustomer: customer || null,
      },
    });

    console.log(`💾 Payment created in database:`);
    console.log(`   - Internal ID: ${payment.id}`);
    console.log(`   - Merchant order_id: ${merchantOrderId || 'none'}`);
    console.log(`   - Gateway order_id: ${gatewayOrderId} (8digits-8digits)`);

    // ✅ ИСПРАВЛЕНО: Теперь генерируем URL с реальным ID платежа
    const baseUrl = process.env.BASE_URL || 'https://tesoft.uk';
    const { finalSuccessUrl, finalFailUrl, dbSuccessUrl, dbFailUrl } = this.generateGatewayUrls(
      gatewayName, 
      payment.id, // ✅ Используем ID платежа
      baseUrl, 
      success_url, 
      fail_url
    );

    // ✅ ИСПРАВЛЕНО: Обновляем платеж с правильными URL
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        successUrl: dbSuccessUrl,
        failUrl: dbFailUrl,
      },
    });

    console.log(`   - DB Success URL: ${dbSuccessUrl}`);
    console.log(`   - DB Fail URL: ${dbFailUrl}`);

    let gatewayPaymentId: string | undefined;
    let externalPaymentUrl: string | undefined;

    try {
      if (gatewayName === 'plisio') {
        let plisioCurrency: string;
        let plisioSourceCurrency: string;
        let isSourceCurrency: boolean;

        if (source_currency) {
          plisioCurrency = source_currency;
          plisioSourceCurrency = currency || 'USD';
          isSourceCurrency = false;
        } else {
          plisioCurrency = currency || 'USD';
          plisioSourceCurrency = 'USD';
          isSourceCurrency = false;
        }

        const plisioResult = await this.plisioService.createPayment({
          paymentId: payment.id,
          orderId: gatewayOrderId,
          amount,
          currency: plisioCurrency,
          productName: `Order ID: ${gatewayOrderId}`,
          description: `Order ID: ${gatewayOrderId}`,
          successUrl: finalSuccessUrl,
          failUrl: finalFailUrl,
          customerEmail: customer_email,
          customerName: customer_name,
          isSourceCurrency: isSourceCurrency,
        });

        gatewayPaymentId = plisioResult.gateway_payment_id;
        externalPaymentUrl = plisioResult.payment_url;

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            externalPaymentUrl: externalPaymentUrl,
            gatewayPaymentId: gatewayPaymentId,
            invoiceTotalSum: Number(plisioResult.invoice_total_sum),
            qrCode: plisioResult.qr_code,
            qrUrl: plisioResult.qr_url,
          },
        });

        const paymentUrl = `https://app.trapay.uk/payment/${payment.id}`;
        console.log(`🔗 Plisio payment URL: ${paymentUrl}`);

        return {
          id: payment.id,
          gateway_payment_id: gatewayPaymentId,
          payment_url: paymentUrl,
          status: payment.status,
        };

      } else if (gatewayName === 'rapyd') {
        const rapydCountry = 'GB';
        console.log(`🇬🇧 Using GB (Britain) as country for Rapyd payment`);

        const rapydResult = await this.rapydService.createPaymentLink({
          paymentId: payment.id,
          orderId: gatewayOrderId,
          orderName: `Order ID: ${gatewayOrderId}`,
          amount,
          currency: currency || 'USD',
          country: rapydCountry,
          language: language || 'EN',
          amountIsEditable: amount_is_editable || false,
          usage: usage || 'ONCE',
          maxPayments: max_payments,
          customer,
          successUrl: finalSuccessUrl,
          failUrl: finalFailUrl,
        });

        gatewayPaymentId = rapydResult.gateway_payment_id;
        externalPaymentUrl = rapydResult.payment_url;

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            externalPaymentUrl: externalPaymentUrl,
            gatewayPaymentId: gatewayPaymentId,
            country: rapydCountry,
          },
        });

        const paymentUrl = `https://tesoft.uk/gateway/payment.php?id=${payment.id}`;
        console.log(`🔗 Rapyd payment URL: ${paymentUrl}`);

        return {
          id: payment.id,
          gateway_payment_id: gatewayPaymentId,
          payment_url: paymentUrl,
          status: payment.status,
        };

      } else if (gatewayName === 'noda') {
        console.log(`🔄 Creating Noda payment with gateway order_id: ${gatewayOrderId} (8digits-8digits format)`);

        const nodaResult = await this.nodaService.createPaymentLink({
          paymentId: payment.id,
          orderId: gatewayOrderId,
          name: `Order ID: ${gatewayOrderId}`,
          paymentDescription: `Order ID: ${gatewayOrderId}`,
          amount,
          currency: currency || 'USD',
          webhookUrl: `https://tesoft.uk/gateways/noda/webhook`,
          returnUrl: finalSuccessUrl,
          expiryDate: expires_at,
        });

        gatewayPaymentId = nodaResult.gateway_payment_id;
        externalPaymentUrl = nodaResult.payment_url;

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            externalPaymentUrl: externalPaymentUrl,
            gatewayPaymentId: gatewayPaymentId,
            qrUrl: nodaResult.qr_code_url,
          },
        });

        const paymentUrl = `https://tesoft.uk/gateway/payment.php?id=${payment.id}`;
        console.log(`🔗 Noda payment URL: ${paymentUrl}`);

        return {
          id: payment.id,
          gateway_payment_id: gatewayPaymentId,
          payment_url: paymentUrl,
          status: payment.status,
        };

      } else if (gatewayName === 'cointopay') {
        console.log(`🪙 Creating CoinToPay payment with gateway order_id: ${gatewayOrderId} (8digits-8digits format)`);
        console.log(`💰 Amount: ${amount} EUR (always EUR for CoinToPay)`);

        const coinToPayResult = await this.coinToPayService.createPaymentLink({
          paymentId: payment.id,
          orderId: gatewayOrderId,
          amount,
        });

        gatewayPaymentId = coinToPayResult.gateway_payment_id;
        externalPaymentUrl = coinToPayResult.payment_url;

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            externalPaymentUrl: externalPaymentUrl,
            gatewayPaymentId: gatewayPaymentId,
            currency: 'EUR',
          },
        });

        // ✅ ДОБАВЛЕНО: Запускаем индивидуальные проверки для CoinToPay платежа
        if (gatewayPaymentId) {
          console.log(`🪙 Scheduling individual status checks for CoinToPay payment: ${payment.id} (${gatewayPaymentId})`);
          coinToPayStatusService.schedulePaymentChecks(payment.id, gatewayPaymentId);
        }

        const paymentUrl = `https://tesoft.uk/gateway/payment.php?id=${payment.id}`;
        console.log(`🔗 CoinToPay payment URL: ${paymentUrl}`);

        return {
          id: payment.id,
          gateway_payment_id: gatewayPaymentId,
          payment_url: paymentUrl,
          status: payment.status,
        };

      } else if (gatewayName.startsWith('klyme_')) {
        const region = getKlymeRegionFromGatewayName(gatewayName);
        
        if (!region) {
          throw new Error(`Invalid KLYME gateway: ${gatewayName}`);
        }

        console.log(`💳 Creating KLYME ${region} payment with gateway order_id: ${gatewayOrderId} (8digits-8digits format)`);
        console.log(`💰 Amount: ${amount} ${currency || 'USD'} (validated for ${region})`);

        const klymeResult = await this.klymeService.createPaymentLink({
          paymentId: payment.id,
          orderId: gatewayOrderId,
          amount,
          currency: currency || 'USD',
          region,
          redirectUrl: finalSuccessUrl,
        });

        gatewayPaymentId = klymeResult.gateway_payment_id;
        externalPaymentUrl = klymeResult.payment_url;

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            externalPaymentUrl: externalPaymentUrl,
            gatewayPaymentId: gatewayPaymentId,
          },
        });

        const paymentUrl = `https://app.trapay.uk/payment/${payment.id}`;
        console.log(`✅ KLYME ${region} payment created successfully with gateway order_id: ${gatewayOrderId}`);
        console.log(`🔗 KLYME ${region} payment URL: ${paymentUrl}`);

        return {
          id: payment.id,
          gateway_payment_id: gatewayPaymentId,
          payment_url: paymentUrl,
          status: payment.status,
        };

      } else {
        throw new Error(`Unsupported gateway: ${gatewayName}`);
      }

    } catch (gatewayError) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
      
      throw new Error(`Gateway error: ${gatewayError instanceof Error ? gatewayError.message : 'Unknown error'}`);
    }
  }

  async getPaymentStatus(paymentId: string): Promise<PaymentStatusResponse | null> {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        gateway: true,
        amount: true,
        currency: true,
        sourceCurrency: true,
        status: true,
        externalPaymentUrl: true,
        successUrl: true,
        failUrl: true,
        customerEmail: true,
        customerName: true,
        invoiceTotalSum: true,
        qrCode: true,
        qrUrl: true,
        orderId: true,
        gatewayOrderId: true,
        country: true,
        language: true,
        amountIsEditable: true,
        maxPayments: true,
        rapydCustomer: true,
        cardLast4: true,
        paymentMethod: true,
        bankId: true,
        remitterIban: true,
        remitterName: true,
        createdAt: true,
        updatedAt: true,
        expiresAt: true,
        shop: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!payment) return null;

    let paymentUrl: string;
    
    if (payment.gateway === 'plisio' || payment.gateway.startsWith('klyme_')) {
      paymentUrl = `https://app.trapay.uk/payment/${payment.id}`;
    } else {
      paymentUrl = `https://tesoft.uk/gateway/payment.php?id=${payment.id}`;
    }

    return {
      id: payment.id,
      gateway: payment.gateway,
      amount: payment.amount,
      currency: payment.currency,
      source_currency: payment.sourceCurrency,
      status: payment.status,
      payment_url: paymentUrl,
      external_payment_url: payment.externalPaymentUrl,
      success_url: payment.successUrl,
      fail_url: payment.failUrl,
      customer_email: payment.customerEmail,
      customer_name: payment.customerName,
      invoice_total_sum: payment.invoiceTotalSum,
      qr_code: payment.qrCode,
      qr_url: payment.qrUrl,
      order_id: payment.orderId,
      gateway_order_id: payment.gatewayOrderId,
      merchant_brand: payment.shop.name,
      country: payment.country,
      language: payment.language,
      amount_is_editable: payment.amountIsEditable,
      max_payments: payment.maxPayments,
      rapyd_customer: payment.rapydCustomer,
      card_last4: payment.cardLast4,
      payment_method: payment.paymentMethod,
      bank_id: payment.bankId,
      remitter_iban: payment.remitterIban,
      remitter_name: payment.remitterName,
      created_at: payment.createdAt,
      updated_at: payment.updatedAt,
      expires_at: payment.expiresAt,
    };
  }

  // ✅ ОБНОВЛЕНО: Enhanced search by all possible IDs
  async getPaymentById(id: string): Promise<PaymentStatusResponse | null> {
    console.log(`🔍 Searching for payment with ID: ${id}`);
    console.log(`🔍 Will search by: internal ID, merchant order ID, gateway order ID, and gateway payment ID`);

    const payment = await prisma.payment.findFirst({
      where: {
        OR: [
          { id: id },                    // ✅ Our internal payment ID
          { orderId: id },               // ✅ Merchant's order ID (can be null)
          { gatewayOrderId: id },        // ✅ Gateway order ID (8digits-8digits format)
          { gatewayPaymentId: id },      // ✅ Gateway payment ID (from payment gateway)
        ],
      },
      select: {
        id: true,
        gateway: true,
        amount: true,
        currency: true,
        sourceCurrency: true,
        status: true,
        externalPaymentUrl: true,
        successUrl: true,
        failUrl: true,
        customerEmail: true,
        customerName: true,
        invoiceTotalSum: true,
        qrCode: true,
        qrUrl: true,
        orderId: true,
        gatewayOrderId: true,
        gatewayPaymentId: true,
        country: true,
        language: true,
        amountIsEditable: true,
        maxPayments: true,
        rapydCustomer: true,
        cardLast4: true,
        paymentMethod: true,
        bankId: true,
        remitterIban: true,
        remitterName: true,
        createdAt: true,
        updatedAt: true,
        expiresAt: true,
        shop: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!payment) {
      console.log(`❌ Payment not found with any of the following criteria:`);
      console.log(`   - Internal ID: ${id}`);
      console.log(`   - Merchant order ID: ${id}`);
      console.log(`   - Gateway order ID: ${id}`);
      console.log(`   - Gateway payment ID: ${id}`);
      return null;
    }

    console.log(`✅ Found payment: ${payment.id}`);
    console.log(`   - Internal ID: ${payment.id}`);
    console.log(`   - Merchant order ID: ${payment.orderId || 'none'}`);
    console.log(`   - Gateway order ID: ${payment.gatewayOrderId || 'none'}`);
    console.log(`   - Gateway payment ID: ${payment.gatewayPaymentId || 'none'}`);
    console.log(`   - Gateway: ${payment.gateway}`);
    console.log(`   - Status: ${payment.status}`);

    let paymentUrl: string;
    
    if (payment.gateway === 'plisio' || payment.gateway.startsWith('klyme_')) {
      paymentUrl = `https://app.trapay.uk/payment/${payment.id}`;
    } else {
      paymentUrl = `https://tesoft.uk/gateway/payment.php?id=${payment.id}`;
    }

    return {
      id: payment.id,
      gateway: payment.gateway,
      amount: payment.amount,
      currency: payment.currency,
      source_currency: payment.sourceCurrency,
      status: payment.status,
      payment_url: paymentUrl,
      external_payment_url: payment.externalPaymentUrl,
      success_url: payment.successUrl,
      fail_url: payment.failUrl,
      customer_email: payment.customerEmail,
      customer_name: payment.customerName,
      invoice_total_sum: payment.invoiceTotalSum,
      qr_code: payment.qrCode,
      qr_url: payment.qrUrl,
      order_id: payment.orderId,
      gateway_order_id: payment.gatewayOrderId,
      merchant_brand: payment.shop.name,
      card_last4: payment.cardLast4,
      payment_method: payment.paymentMethod,
      bank_id: payment.bankId,
      remitter_iban: payment.remitterIban,
      remitter_name: payment.remitterName,
      created_at: payment.createdAt,
      updated_at: payment.updatedAt,
      expires_at: payment.expiresAt,
    };
  }

  async getPaymentsByShop(shopId: string, filters: PaymentFilters): Promise<{
    payments: any[];
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
      where.status = status.toUpperCase();
    }
    
    if (gateway) {
      if (isValidGatewayId(gateway)) {
        const gatewayName = getGatewayNameById(gateway);
        if (gatewayName) {
          where.gateway = gatewayName;
        }
      } else {
        where.gateway = gateway.toLowerCase();
      }
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          gateway: true,
          amount: true,
          currency: true,
          sourceCurrency: true,
          usage: true,
          status: true,
          externalPaymentUrl: true,
          successUrl: true,
          failUrl: true,
          expiresAt: true,
          orderId: true,
          gatewayOrderId: true,
          customerEmail: true,
          customerName: true,
          invoiceTotalSum: true,
          qrCode: true,
          qrUrl: true,
          country: true,
          language: true,
          amountIsEditable: true,
          maxPayments: true,
          rapydCustomer: true,
          cardLast4: true,
          paymentMethod: true,
          bankId: true,
          remitterIban: true,
          remitterName: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      payments: payments.map(payment => {
        let paymentUrl: string;
        
        if (payment.gateway === 'plisio' || payment.gateway.startsWith('klyme_')) {
          paymentUrl = `https://app.trapay.uk/payment/${payment.id}`;
        } else {
          paymentUrl = `https://tesoft.uk/gateway/payment.php?id=${payment.id}`;
        }

        return {
          id: payment.id,
          gateway: payment.gateway,
          title: `Order ID: ${payment.gatewayOrderId}`,
          amount: payment.amount,
          currency: payment.currency,
          source_currency: payment.sourceCurrency,
          usage: payment.usage,
          status: payment.status.toLowerCase(),
          payment_url: paymentUrl,
          external_payment_url: payment.externalPaymentUrl,
          success_url: payment.successUrl,
          fail_url: payment.failUrl,
          expires_at: payment.expiresAt,
          order_id: payment.orderId,
          gateway_order_id: payment.gatewayOrderId,
          customer_email: payment.customerEmail,
          customer_name: payment.customerName,
          invoice_total_sum: payment.invoiceTotalSum,
          qr_code: payment.qrCode,
          qr_url: payment.qrUrl,
          country: payment.country,
          language: payment.language,
          amount_is_editable: payment.amountIsEditable,
          max_payments: payment.maxPayments,
          rapyd_customer: payment.rapydCustomer,
          card_last4: payment.cardLast4,
          payment_method: payment.paymentMethod,
          bank_id: payment.bankId,
          remitter_iban: payment.remitterIban,
          remitter_name: payment.remitterName,
          created_at: payment.createdAt,
          updated_at: payment.updatedAt,
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

  async getPaymentByShopAndId(shopId: string, paymentId: string): Promise<any | null> {
    const payment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        shopId,
      },
      select: {
        id: true,
        gateway: true,
        amount: true,
        currency: true,
        sourceCurrency: true,
        usage: true,
        status: true,
        externalPaymentUrl: true,
        successUrl: true,
        failUrl: true,
        expiresAt: true,
        orderId: true,
        gatewayOrderId: true,
        gatewayPaymentId: true,
        customerEmail: true,
        customerName: true,
        invoiceTotalSum: true,
        qrCode: true,
        qrUrl: true,
        country: true,
        language: true,
        amountIsEditable: true,
        maxPayments: true,
        rapydCustomer: true,
        cardLast4: true,
        paymentMethod: true,
        bankId: true,
        remitterIban: true,
        remitterName: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!payment) return null;

    let paymentUrl: string;
    
    if (payment.gateway === 'plisio' || payment.gateway.startsWith('klyme_')) {
      paymentUrl = `https://app.trapay.uk/payment/${payment.id}`;
    } else {
      paymentUrl = `https://tesoft.uk/gateway/payment.php?id=${payment.id}`;
    }

    return {
      id: payment.id,
      gateway: payment.gateway,
      title: `Order ID: ${payment.gatewayOrderId}`,
      amount: payment.amount,
      currency: payment.currency,
      source_currency: payment.sourceCurrency,
      usage: payment.usage,
      status: payment.status.toLowerCase(),
      payment_url: paymentUrl,
      external_payment_url: payment.externalPaymentUrl,
      success_url: payment.successUrl,
      fail_url: payment.failUrl,
      expires_at: payment.expiresAt,
      order_id: payment.orderId,
      gateway_order_id: payment.gatewayOrderId,
      gateway_payment_id: payment.gatewayPaymentId,
      customer_email: payment.customerEmail,
      customer_name: payment.customerName,
      invoice_total_sum: payment.invoiceTotalSum,
      qr_code: payment.qrCode,
      qr_url: payment.qrUrl,
      country: payment.country,
      language: payment.language,
      amount_is_editable: payment.amountIsEditable,
      max_payments: payment.maxPayments,
      rapyd_customer: payment.rapydCustomer,
      card_last4: payment.cardLast4,
      payment_method: payment.paymentMethod,
      bank_id: payment.bankId,
      remitter_iban: payment.remitterIban,
      remitter_name: payment.remitterName,
      created_at: payment.createdAt,
      updated_at: payment.updatedAt,
    };
  }
}
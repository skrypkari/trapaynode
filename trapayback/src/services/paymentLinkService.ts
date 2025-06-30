import prisma from '../config/database';
import { 
  CreatePaymentLinkRequest, 
  UpdatePaymentLinkRequest, 
  PaymentLinkResponse, 
  PaymentLinkFilters,
  PaymentLinkStatistics,
  PublicPaymentLinkData,
  InitiatePaymentFromLinkRequest,
  InitiatePaymentFromLinkResponse
} from '../types/paymentLink';
import { PlisioService } from './gateways/plisioService';
import { RapydService } from './gateways/rapydService';
import { NodaService } from './gateways/nodaService';
import { CoinToPayService } from './gateways/coinToPayService';
import { KlymeService } from './gateways/klymeService';
import { coinToPayStatusService } from './coinToPayStatusService'; // ✅ ДОБАВЛЕНО
import { getGatewayNameById, isValidGatewayId, getKlymeRegionFromGatewayName } from '../types/gateway';
import { currencyService } from './currencyService';

export class PaymentLinkService {
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

  private generateGatewayOrderId(): string {
    const generateSegment = () => {
      return Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
    };
    
    return `${generateSegment()}-${generateSegment()}`;
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

  async createPaymentLink(shopId: string, linkData: CreatePaymentLinkRequest): Promise<PaymentLinkResponse> {
    if (!isValidGatewayId(linkData.gateway)) {
      throw new Error(`Invalid gateway ID: ${linkData.gateway}. Valid IDs are: 0001 (Plisio), 0010 (Rapyd), 0100 (CoinToPay), 1000 (Noda), 1001 (KLYME EU), 1010 (KLYME GB), 1100 (KLYME DE)`);
    }

    const gatewayName = getGatewayNameById(linkData.gateway);
    if (!gatewayName) {
      throw new Error(`Gateway not found for ID: ${linkData.gateway}`);
    }

    console.log(`🔗 Creating payment link for gateway: ${gatewayName}`);

    // ✅ ДОБАВЛЕНО: Проверяем разрешения на использование шлюза
    await this.checkGatewayPermission(shopId, gatewayName);

    if (gatewayName === 'plisio' && !linkData.sourceCurrency) {
      throw new Error('sourceCurrency is required for Plisio payment links');
    }

    if (gatewayName.startsWith('klyme_')) {
      const region = getKlymeRegionFromGatewayName(gatewayName);
      console.log(`💳 Creating KLYME ${region} payment link`);
    }

    let rapydCountry = linkData.country;
    if (gatewayName === 'rapyd') {
      rapydCountry = 'GB';
      console.log(`🇬🇧 Using GB (Britain) as country for Rapyd payment link`);
    }

    if (!linkData.amount || linkData.amount <= 0) {
      throw new Error('amount is required and must be positive');
    }

    let finalCurrency = linkData.currency || 'USD';
    if (gatewayName === 'cointopay') {
      finalCurrency = 'EUR';
      console.log(`🪙 Using EUR as currency for CoinToPay payment link`);
    }

    this.validateKlymeCurrency(gatewayName, finalCurrency);

    // ✅ ИСПРАВЛЕНО: Создаем payment link с временными URL, которые будут обновлены при создании платежа
    const paymentLink = await prisma.paymentLink.create({
      data: {
        shopId,
        amount: linkData.amount,
        currency: finalCurrency,
        sourceCurrency: linkData.sourceCurrency || undefined,
        gateway: gatewayName,
        maxPayments: linkData.maxPayments || 1,
        currentPayments: 0,
        status: 'ACTIVE',
        expiresAt: linkData.expiresAt ? new Date(linkData.expiresAt) : undefined,
        // ✅ ИСПРАВЛЕНО: Сохраняем пользовательские URL или null (будут заполнены при создании платежа)
        successUrl: linkData.successUrl || null,
        failUrl: linkData.failUrl || null,
        country: rapydCountry,
        language: linkData.language || 'EN',
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

    console.log(`✅ Payment link created: ${paymentLink.id} (${gatewayName})`);
    console.log(`💰 Fixed amount: ${paymentLink.amount} ${paymentLink.currency}`);
    console.log(`🔗 Link URL: https://app.trapay.uk/link/${paymentLink.id}`);
    console.log(`📝 Note: Success/Fail URLs will be generated when payment is created`);

    return this.formatPaymentLinkResponse(paymentLink);
  }

  async getPaymentLinks(shopId: string, filters: PaymentLinkFilters): Promise<{
    links: PaymentLinkResponse[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const { page, limit, status, gateway, search } = filters;
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

    if (search) {
      where.OR = [
        { gateway: { contains: search, mode: 'insensitive' } },
        { currency: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [links, total] = await Promise.all([
      prisma.paymentLink.findMany({
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
          payments: {
            select: {
              id: true,
              amount: true,
              currency: true,
              status: true,
              customerEmail: true,
              customerName: true,
              createdAt: true,
              paidAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
        },
      }),
      prisma.paymentLink.count({ where }),
    ]);

    return {
      links: links.map(link => this.formatPaymentLinkResponse(link)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPaymentLinkById(shopId: string, linkId: string): Promise<PaymentLinkResponse | null> {
    const link = await prisma.paymentLink.findFirst({
      where: {
        id: linkId,
        shopId,
      },
      include: {
        shop: {
          select: {
            name: true,
            username: true,
          },
        },
        payments: {
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            customerEmail: true,
            customerName: true,
            createdAt: true,
            paidAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!link) return null;

    return this.formatPaymentLinkResponse(link);
  }

  async updatePaymentLink(shopId: string, linkId: string, updateData: UpdatePaymentLinkRequest): Promise<PaymentLinkResponse> {
    const updatePayload: any = { ...updateData };
    
    if (updateData.gateway) {
      if (isValidGatewayId(updateData.gateway)) {
        const gatewayName = getGatewayNameById(updateData.gateway);
        if (gatewayName) {
          // ✅ ДОБАВЛЕНО: Проверяем разрешения при обновлении шлюза
          await this.checkGatewayPermission(shopId, gatewayName);
          updatePayload.gateway = gatewayName;
        }
      } else {
        updatePayload.gateway = updateData.gateway.toLowerCase();
      }
    }

    if (updatePayload.gateway === 'rapyd' || (updateData.country && updatePayload.gateway !== 'rapyd')) {
      if (updatePayload.gateway === 'rapyd') {
        updatePayload.country = 'GB';
        console.log(`🇬🇧 Forcing GB (Britain) as country for Rapyd payment link update`);
      }
    }

    if (updatePayload.gateway === 'cointopay') {
      updatePayload.currency = 'EUR';
      console.log(`🪙 Forcing EUR as currency for CoinToPay payment link update`);
    }

    if (updatePayload.gateway && updatePayload.currency) {
      this.validateKlymeCurrency(updatePayload.gateway, updatePayload.currency);
    }

    if (updateData.expiresAt) {
      updatePayload.expiresAt = new Date(updateData.expiresAt);
    }

    const updatedLink = await prisma.paymentLink.update({
      where: {
        id: linkId,
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
        payments: {
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            customerEmail: true,
            customerName: true,
            createdAt: true,
            paidAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    return this.formatPaymentLinkResponse(updatedLink);
  }

  async deletePaymentLink(shopId: string, linkId: string): Promise<void> {
    await prisma.paymentLink.delete({
      where: {
        id: linkId,
        shopId,
      },
    });
  }

  async getPublicPaymentLinkData(linkId: string): Promise<PublicPaymentLinkData | null> {
    const link = await prisma.paymentLink.findUnique({
      where: { id: linkId },
      include: {
        shop: {
          select: {
            name: true,
            status: true,
          },
        },
      },
    });

    if (!link) return null;

    const isExpired = link.expiresAt && link.expiresAt < new Date();
    const isCompleted = link.currentPayments >= link.maxPayments;
    const isShopActive = link.shop.status === 'ACTIVE';
    const isLinkActive = link.status === 'ACTIVE';

    const isAvailable = !isExpired && !isCompleted && isShopActive && isLinkActive;
    const remainingPayments = Math.max(0, link.maxPayments - link.currentPayments);

    return {
      id: link.id,
      amount: link.amount,
      currency: link.currency,
      sourceCurrency: link.sourceCurrency || undefined,
      gateway: link.gateway,
      maxPayments: link.maxPayments,
      currentPayments: link.currentPayments,
      status: link.status,
      expiresAt: link.expiresAt || undefined,
      shopName: link.shop.name,
      isAvailable,
      remainingPayments,
    };
  }

  async initiatePaymentFromLink(linkData: InitiatePaymentFromLinkRequest): Promise<InitiatePaymentFromLinkResponse> {
    const { linkId, customerEmail, customerName } = linkData;

    const link = await prisma.paymentLink.findUnique({
      where: { id: linkId },
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            status: true,
            paymentGateways: true, // ✅ ДОБАВЛЕНО: Получаем настройки шлюзов
          },
        },
      },
    });

    if (!link) {
      throw new Error('Payment link not found');
    }

    const isExpired = link.expiresAt && link.expiresAt < new Date();
    const isCompleted = link.currentPayments >= link.maxPayments;
    const isShopActive = link.shop.status === 'ACTIVE';
    const isLinkActive = link.status === 'ACTIVE';

    if (isExpired) {
      throw new Error('Payment link has expired');
    }

    if (isCompleted) {
      throw new Error('Payment link has reached maximum payments');
    }

    if (!isShopActive) {
      throw new Error('Shop is not active');
    }

    if (!isLinkActive) {
      throw new Error('Payment link is not active');
    }

    // ✅ ДОБАВЛЕНО: Проверяем разрешения на использование шлюза при инициации платежа
    await this.checkGatewayPermission(link.shopId, link.gateway);

    const paymentAmount = link.amount;

    console.log(`💳 Initiating payment from link ${linkId}: ${paymentAmount} ${link.currency}`);
    console.log(`👤 Customer: ${customerName || 'Anonymous'} (${customerEmail || 'no email'})`);

    this.validateKlymeCurrency(link.gateway, link.currency);

    const gatewayOrderId = this.generateGatewayOrderId();
    console.log(`🎯 Generated gateway order_id: ${gatewayOrderId} (8digits-8digits format for ${link.gateway})`);

    // ✅ ИСПРАВЛЕНО: Сначала создаем платеж, чтобы получить его ID
    const payment = await prisma.payment.create({
      data: {
        shopId: link.shopId,
        paymentLinkId: link.id,
        gateway: link.gateway,
        amount: paymentAmount,
        currency: link.currency,
        sourceCurrency: link.sourceCurrency || undefined,
        usage: 'ONCE',
        expiresAt: link.expiresAt || undefined,
        // ✅ ВРЕМЕННО: Устанавливаем временные URL, обновим их после генерации
        successUrl: 'temp',
        failUrl: 'temp',
        status: 'PENDING',
        orderId: null,
        gatewayOrderId: gatewayOrderId,
        customerEmail: customerEmail || undefined,
        customerName: customerName || undefined,
        country: link.country || undefined,
        language: link.language || undefined,
        amountIsEditable: false,
        maxPayments: 1,
      },
    });

    console.log(`💾 Payment created: ${payment.id}`);

    // ✅ ИСПРАВЛЕНО: Теперь генерируем URL с реальным ID платежа
    const baseUrl = process.env.BASE_URL || 'https://tesoft.uk';
    const { finalSuccessUrl, finalFailUrl, dbSuccessUrl, dbFailUrl } = this.generateGatewayUrls(
      link.gateway, 
      payment.id, // ✅ Используем ID платежа, а не ссылки
      baseUrl, 
      link.successUrl || undefined, 
      link.failUrl || undefined
    );

    // ✅ ИСПРАВЛЕНО: Обновляем платеж с правильными URL
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        successUrl: dbSuccessUrl,
        failUrl: dbFailUrl,
      },
    });

    console.log(`💰 Amount: ${paymentAmount} ${link.currency}`);
    console.log(`👤 Customer: ${customerName || 'Anonymous'} (${customerEmail || 'no email'})`);
    console.log(`💾 DB Success URL: ${dbSuccessUrl}`);
    console.log(`💾 DB Fail URL: ${dbFailUrl}`);

    let gatewayPaymentId: string | undefined;
    let externalPaymentUrl: string | undefined;

    try {
      if (link.gateway === 'plisio') {
        console.log(`💰 Plisio payment link mapping:`);
        console.log(`   - link.currency (merchant fiat currency): ${link.currency}`);
        console.log(`   - link.sourceCurrency (crypto currency for payment): ${link.sourceCurrency}`);

        const plisioResult = await this.plisioService.createPayment({
          paymentId: payment.id,
          orderId: gatewayOrderId,
          amount: paymentAmount,
          currency: link.currency,
          productName: `Payment ${paymentAmount} ${link.currency}`,
          description: `Payment ${paymentAmount} ${link.currency}`,
          successUrl: finalSuccessUrl,
          failUrl: finalFailUrl,
          customerEmail: customerEmail || undefined,
          customerName: customerName || undefined,
          isSourceCurrency: true,
          sourceCurrency: link.sourceCurrency || undefined,
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
          paymentId: payment.id,
          paymentUrl: paymentUrl,
          expiresAt: payment.expiresAt || undefined,
        };

      } else if (link.gateway === 'rapyd') {
        const rapydResult = await this.rapydService.createPaymentLink({
          paymentId: payment.id,
          orderId: gatewayOrderId,
          orderName: `Payment ${paymentAmount} ${link.currency}`,
          amount: paymentAmount,
          currency: link.currency,
          country: link.country!,
          language: link.language || 'EN',
          amountIsEditable: false,
          usage: 'ONCE',
          maxPayments: 1,
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
          },
        });

        const paymentUrl = `https://tesoft.uk/gateway/payment.php?id=${payment.id}`;
        console.log(`🔗 Rapyd payment URL: ${paymentUrl}`);

        return {
          paymentId: payment.id,
          paymentUrl: paymentUrl,
          expiresAt: payment.expiresAt || undefined,
        };

      } else if (link.gateway === 'noda') {
        const nodaResult = await this.nodaService.createPaymentLink({
          paymentId: payment.id,
          orderId: gatewayOrderId,
          name: `Payment ${paymentAmount} ${link.currency}`,
          paymentDescription: `Payment ${paymentAmount} ${link.currency}`,
          amount: paymentAmount,
          currency: link.currency,
          webhookUrl: `https://tesoft.uk/gateways/noda/webhook`,
          returnUrl: finalSuccessUrl,
          expiryDate: link.expiresAt?.toISOString(),
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
          paymentId: payment.id,
          paymentUrl: paymentUrl,
          expiresAt: payment.expiresAt || undefined,
        };

      } else if (link.gateway === 'cointopay') {
        console.log(`🪙 Creating CoinToPay payment from link with gateway order_id: ${gatewayOrderId} (8digits-8digits format)`);
        console.log(`💰 Amount: ${paymentAmount} EUR (always EUR for CoinToPay)`);

        const coinToPayResult = await this.coinToPayService.createPaymentLink({
          paymentId: payment.id,
          orderId: gatewayOrderId,
          amount: paymentAmount,
        });

        gatewayPaymentId = coinToPayResult.gateway_payment_id;
        externalPaymentUrl = coinToPayResult.payment_url;

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            externalPaymentUrl: externalPaymentUrl,
            gatewayPaymentId: gatewayPaymentId,
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
          paymentId: payment.id,
          paymentUrl: paymentUrl,
          expiresAt: payment.expiresAt || undefined,
        };

      } else if (link.gateway.startsWith('klyme_')) {
        const region = getKlymeRegionFromGatewayName(link.gateway);
        
        if (!region) {
          throw new Error(`Invalid KLYME gateway: ${link.gateway}`);
        }

        console.log(`💳 Creating KLYME ${region} payment from link with gateway order_id: ${gatewayOrderId} (8digits-8digits format)`);
        console.log(`💰 Amount: ${paymentAmount} ${link.currency} (validated for ${region})`);

        const klymeResult = await this.klymeService.createPaymentLink({
          paymentId: payment.id,
          orderId: gatewayOrderId,
          amount: paymentAmount,
          currency: link.currency,
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
          paymentId: payment.id,
          paymentUrl: paymentUrl,
          expiresAt: payment.expiresAt || undefined,
        };

      } else {
        throw new Error(`Unsupported gateway: ${link.gateway}`);
      }

    } catch (gatewayError) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
      
      throw new Error(`Gateway error: ${gatewayError instanceof Error ? gatewayError.message : 'Unknown error'}`);
    }
  }

  // ✅ ИСПРАВЛЕНО: Improved handleSuccessfulPayment to prevent double counting
  async handleSuccessfulPayment(paymentId: string): Promise<void> {
    console.log(`📈 Processing successful payment for payment link counter: ${paymentId}`);

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        paymentLink: true,
      },
    });

    if (!payment || !payment.paymentLink) {
      console.log(`📈 Payment ${paymentId} is not linked to a payment link, skipping counter update`);
      return;
    }

    // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Проверяем, что платеж действительно стал PAID и не был учтен ранее
    if (payment.status !== 'PAID') {
      console.log(`📈 Payment ${paymentId} status is ${payment.status}, not PAID. Skipping counter update.`);
      return;
    }

    // ✅ ДОБАВЛЕНО: Проверяем, не был ли этот платеж уже учтен в счетчике
    // Мы можем использовать поле paidAt как индикатор того, что платеж был обработан
    if (!payment.paidAt) {
      console.log(`📈 Payment ${paymentId} has no paidAt timestamp, might not be properly paid. Skipping counter update.`);
      return;
    }

    // ✅ ДОБАВЛЕНО: Используем транзакцию для атомарного обновления
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Получаем текущее состояние payment link
        const currentLink = await tx.paymentLink.findUnique({
          where: { id: payment.paymentLinkId! },
          select: {
            id: true,
            currentPayments: true,
            maxPayments: true,
            status: true,
          },
        });

        if (!currentLink) {
          throw new Error(`Payment link ${payment.paymentLinkId} not found`);
        }

        // ✅ ДОБАВЛЕНО: Проверяем, что счетчик еще не достиг максимума
        if (currentLink.currentPayments >= currentLink.maxPayments) {
          console.log(`📈 Payment link ${payment.paymentLinkId} already at max payments (${currentLink.currentPayments}/${currentLink.maxPayments}), skipping increment`);
          return currentLink;
        }

        // ✅ ДОБАВЛЕНО: Проверяем, что этот конкретный платеж еще не был учтен
        // Мы можем добавить специальное поле или использовать логику проверки
        const existingSuccessfulPayments = await tx.payment.count({
          where: {
            paymentLinkId: payment.paymentLinkId!,
            status: 'PAID',
            paidAt: { not: null },
            id: { not: paymentId }, // Исключаем текущий платеж
          },
        });

        const expectedCurrentPayments = existingSuccessfulPayments + 1; // +1 для текущего платежа

        // ✅ ИСПРАВЛЕНИЕ: Устанавливаем правильное значение счетчика
        const updatedLink = await tx.paymentLink.update({
          where: { id: payment.paymentLinkId! },
          data: {
            currentPayments: expectedCurrentPayments,
            // Если достигли максимума, помечаем как завершенный
            status: expectedCurrentPayments >= currentLink.maxPayments ? 'COMPLETED' : currentLink.status,
          },
        });

        console.log(`📈 Payment link ${payment.paymentLinkId} counter updated: ${currentLink.currentPayments} -> ${expectedCurrentPayments}/${currentLink.maxPayments}`);

        return updatedLink;
      });

      if (result.status === 'COMPLETED') {
        console.log(`🏁 Payment link ${payment.paymentLinkId} completed (reached max payments: ${result.currentPayments}/${result.maxPayments})`);
      }

    } catch (error) {
      console.error(`❌ Failed to update payment link counter for payment ${paymentId}:`, error);
      // Не пробрасываем ошибку, чтобы не нарушить основной процесс обработки платежа
    }
  }

  async getPaymentLinkStatistics(shopId: string): Promise<PaymentLinkStatistics> {
    const [
      totalLinks,
      activeLinks,
      totalPayments,
      paidPayments,
    ] = await Promise.all([
      prisma.paymentLink.count({
        where: { shopId },
      }),
      prisma.paymentLink.count({
        where: { 
          shopId,
          status: 'ACTIVE',
        },
      }),
      prisma.payment.count({
        where: {
          shopId,
          paymentLinkId: { not: null },
        },
      }),
      prisma.payment.findMany({
        where: {
          shopId,
          paymentLinkId: { not: null },
          status: 'PAID',
        },
        select: {
          amount: true,
          currency: true,
        },
      }),
    ]);

    let totalRevenue = 0;
    for (const payment of paidPayments) {
      const usdtAmount = await currencyService.convertToUSDT(payment.amount, payment.currency);
      totalRevenue += usdtAmount;
    }

    const conversionRate = totalPayments > 0 ? (paidPayments.length / totalPayments) * 100 : 0;

    return {
      totalLinks,
      activeLinks,
      totalPayments,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      conversionRate: Math.round(conversionRate * 100) / 100,
    };
  }

  private formatPaymentLinkResponse(link: any): PaymentLinkResponse {
    return {
      id: link.id,
      shopId: link.shopId,
      amount: link.amount,
      currency: link.currency,
      sourceCurrency: link.sourceCurrency || undefined,
      gateway: link.gateway,
      maxPayments: link.maxPayments,
      currentPayments: link.currentPayments,
      status: link.status,
      expiresAt: link.expiresAt || undefined,
      successUrl: link.successUrl || undefined,
      failUrl: link.failUrl || undefined,
      country: link.country || undefined,
      language: link.language || undefined,
      linkUrl: `https://app.trapay.uk/link/${link.id}`,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
      shop: link.shop,
      payments: link.payments,
    };
  }
}
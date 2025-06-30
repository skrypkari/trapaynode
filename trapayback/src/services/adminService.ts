import prisma from '../config/database';
import { currencyService } from './currencyService';
import { UserService } from './userService';
import { telegramBotService } from './telegramBotService';
import { CreateUserRequest, UserResponse, UpdateUserRequest } from '../types/user';
import { getGatewayNameById, isValidGatewayId } from '../types/gateway';
import { 
  PayoutStats, 
  PaymentForPayout, 
  MerchantAwaitingPayout, 
  MerchantsAwaitingPayoutFilters,
  CreatePayoutRequest,
  PayoutResponse,
  PayoutFilters
} from '../types/admin';

export interface AdminStatistics {
  totalRevenue: number; // Total revenue in USDT
  totalUsers: number; // Total number of shops
  totalPayments: number; // Total number of payments
  averagePayment: number; // Average payment amount in USDT
  dailyRevenue: Array<{ date: string; amount: number }>; // Daily revenue in USDT
}

export interface UserFilters {
  page: number;
  limit: number;
  status?: string;
}

export interface PaymentFilters {
  page: number;
  limit: number;
  status?: string;
  gateway?: string;
  shopId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface AdminPaymentResponse {
  id: string;
  shopId: string;
  shopName: string;
  shopUsername: string;
  gateway: string;
  orderId?: string | null;
  gatewayOrderId?: string | null; // ✅ ДОБАВЛЕНО: ID который передается в шлюз
  amount: number;
  currency: string;
  sourceCurrency?: string | null;
  status: string;
  usage: string;
  externalPaymentUrl?: string | null;
  gatewayPaymentId?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  // Payment details
  cardLast4?: string | null;
  paymentMethod?: string | null;
  bankId?: string | null;
  remitterIban?: string | null;
  remitterName?: string | null;
  // ✅ ДОБАВЛЕНО: Поля для chargeback и refund
  chargebackAmount?: number | null;
  adminNotes?: string | null;
  statusChangedBy?: string | null;
  statusChangedAt?: Date | null;
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date | null;
}

export class AdminService {
  private userService: UserService;

  constructor() {
    this.userService = new UserService();
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

  // Helper method to get gateway-specific settings for a shop
  private getGatewaySettings(shop: { gatewaySettings: string | null }, gateway: string): { commission: number; payoutDelay: number } {
    if (!shop.gatewaySettings) {
      return { commission: 0, payoutDelay: 0 }; // Default values
    }

    try {
      const gatewaySettings = JSON.parse(shop.gatewaySettings);
      const gatewayName = gateway.charAt(0).toUpperCase() + gateway.slice(1).toLowerCase(); // Capitalize first letter
      
      if (gatewaySettings && gatewaySettings[gatewayName]) {
        return {
          commission: gatewaySettings[gatewayName].commission || 0,
          payoutDelay: gatewaySettings[gatewayName].payoutDelay || 0,
        };
      }
    } catch (error) {
      console.error('Error parsing gateway settings:', error);
    }
    
    return { commission: 0, payoutDelay: 0 }; // Fallback
  }

  // ✅ ОБНОВЛЕНО: Helper method to check if payment is eligible for payout (исключаем REFUND и CHARGEBACK)
  private isEligibleForPayout(payment: PaymentForPayout): boolean {
    // ✅ ИСКЛЮЧАЕМ платежи со статусами REFUND и CHARGEBACK
    if (payment.status !== 'PAID' || payment.merchantPaid || !payment.paidAt) {
      return false;
    }

    const gatewayConfig = this.getGatewaySettings(payment.shop, payment.gateway);
    const payoutDelayMs = gatewayConfig.payoutDelay * 24 * 60 * 60 * 1000; // Convert days to milliseconds
    const eligibleDate = new Date(payment.paidAt.getTime() + payoutDelayMs);
    
    return new Date() > eligibleDate;
  }

  // Helper method to calculate amount after commission
  private calculateAmountAfterCommission(amount: number, commission: number): number {
    return amount * (1 - commission / 100);
  }

  // ✅ ОБНОВЛЕНО: Helper method to calculate effective amount for statistics (учитывает chargeback штрафы в USDT)
  private calculateEffectiveAmount(payment: any): number {
    switch (payment.status) {
      case 'PAID':
        // Обычный оплаченный платеж - учитываем полную сумму
        return payment.amount;
      case 'CHARGEBACK':
        // ✅ ИСПРАВЛЕНО: Чарджбэк - вычитаем сумму штрафа (уже в USDT, отрицательное влияние)
        return -(payment.chargebackAmount || 0);
      case 'REFUND':
        // Возврат - не учитываем в расчетах
        return 0;
      default:
        // Другие статусы - не учитываем
        return 0;
    }
  }

  // New method to create payout
  async createPayout(payoutData: CreatePayoutRequest): Promise<PayoutResponse> {
    const { shopId, amount, network, notes } = payoutData;

    console.log(`💸 Creating payout for shop ${shopId}: ${amount} USDT via ${network}`);

    // Verify shop exists
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        id: true,
        name: true,
        username: true,
        status: true,
      },
    });

    if (!shop) {
      throw new Error('Shop not found');
    }

    if (shop.status !== 'ACTIVE') {
      throw new Error('Shop is not active');
    }

    // Create payout record
    const payout = await prisma.payout.create({
      data: {
        shopId,
        amount,
        network,
        status: 'COMPLETED', // Always completed for admin-created payouts
        notes: notes || null,
        paidAt: new Date(), // Set to current time
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

    // Mark eligible payments as paid out
    await this.markPaymentsAsPaidOut(shopId, amount);

    // Send Telegram notification
    try {
      await telegramBotService.sendPayoutNotification(shopId, payout, 'completed');
    } catch (error) {
      console.error('Failed to send Telegram payout notification:', error);
    }

    console.log(`✅ Payout created successfully: ${payout.id}`);

    return {
      id: payout.id,
      shopId: payout.shopId,
      shopName: payout.shop.name,
      shopUsername: payout.shop.username,
      amount: payout.amount,
      network: payout.network,
      status: payout.status,
      txid: payout.txid,
      notes: payout.notes,
      createdAt: payout.createdAt,
      paidAt: payout.paidAt!,
    };
  }

  // Helper method to mark payments as paid out
  private async markPaymentsAsPaidOut(shopId: string, payoutAmount: number): Promise<void> {
    console.log(`🔄 Marking payments as paid out for shop ${shopId}, amount: ${payoutAmount} USDT`);

    // ✅ ОБНОВЛЕНО: Получаем только PAID платежи (исключаем REFUND и CHARGEBACK)
    const eligiblePayments = await prisma.payment.findMany({
      where: {
        shopId,
        status: 'PAID', // ✅ Только PAID платежи
        merchantPaid: false,
        paidAt: { not: null },
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        gateway: true,
        paidAt: true,
        shop: {
          select: {
            gatewaySettings: true,
          },
        },
      },
      orderBy: {
        paidAt: 'asc', // Oldest first
      },
    });

    let remainingAmount = payoutAmount;
    const paymentsToUpdate: string[] = [];

    for (const payment of eligiblePayments) {
      const paymentForCheck = {
        ...payment,
        status: 'PAID',
        merchantPaid: false,
        shop: { gatewaySettings: payment.shop.gatewaySettings },
      } as PaymentForPayout;

      // Check if payment is eligible
      if (!this.isEligibleForPayout(paymentForCheck)) {
        continue;
      }

      // Convert payment amount to USDT
      const amountUSDT = await currencyService.convertToUSDT(payment.amount, payment.currency);
      
      // Get commission and calculate net amount
      const gatewayConfig = this.getGatewaySettings(payment.shop, payment.gateway);
      const netAmountUSDT = this.calculateAmountAfterCommission(amountUSDT, gatewayConfig.commission);

      if (netAmountUSDT <= remainingAmount) {
        paymentsToUpdate.push(payment.id);
        remainingAmount -= netAmountUSDT;
        
        if (remainingAmount <= 0.01) { // Stop when remaining is very small
          break;
        }
      }
    }

    // Update payments as paid out
    if (paymentsToUpdate.length > 0) {
      await prisma.payment.updateMany({
        where: {
          id: { in: paymentsToUpdate },
        },
        data: {
          merchantPaid: true,
        },
      });

      console.log(`✅ Marked ${paymentsToUpdate.length} payments as paid out`);
    }
  }

  // New method to get all payouts with filters
  async getAllPayouts(filters: PayoutFilters): Promise<{
    payouts: PayoutResponse[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const { page, limit, shopId, network, dateFrom, dateTo, search } = filters;
    const skip = (page - 1) * limit;

    console.log(`📋 Getting payouts with filters:`, filters);

    // Build where clause
    const where: any = {};
    
    if (shopId) {
      where.shopId = shopId;
    }
    
    if (network) {
      where.network = network;
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

    if (search) {
      where.OR = [
        { txid: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { shop: { name: { contains: search, mode: 'insensitive' } } },
        { shop: { username: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [payouts, total] = await Promise.all([
      prisma.payout.findMany({
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
      prisma.payout.count({ where }),
    ]);

    console.log(`📊 Found ${payouts.length} payouts out of ${total} total`);

    const formattedPayouts: PayoutResponse[] = payouts.map(payout => ({
      id: payout.id,
      shopId: payout.shopId,
      shopName: payout.shop.name,
      shopUsername: payout.shop.username,
      amount: payout.amount,
      network: payout.network,
      status: payout.status,
      txid: payout.txid,
      notes: payout.notes,
      createdAt: payout.createdAt,
      paidAt: payout.paidAt!,
    }));

    return {
      payouts: formattedPayouts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // New method to get payout by ID
  async getPayoutById(id: string): Promise<PayoutResponse | null> {
    console.log(`🔍 Getting payout by ID: ${id}`);

    const payout = await prisma.payout.findUnique({
      where: { id },
      include: {
        shop: {
          select: {
            name: true,
            username: true,
          },
        },
      },
    });

    if (!payout) {
      console.log(`❌ Payout not found: ${id}`);
      return null;
    }

    console.log(`✅ Found payout: ${payout.amount} USDT via ${payout.network}`);

    return {
      id: payout.id,
      shopId: payout.shopId,
      shopName: payout.shop.name,
      shopUsername: payout.shop.username,
      amount: payout.amount,
      network: payout.network,
      status: payout.status,
      txid: payout.txid,
      notes: payout.notes,
      createdAt: payout.createdAt,
      paidAt: payout.paidAt!,
    };
  }

  // New method to delete payout
  async deletePayout(id: string): Promise<void> {
    console.log(`🗑️ Deleting payout: ${id}`);

    const payout = await prisma.payout.findUnique({
      where: { id },
      select: { id: true, shopId: true, amount: true },
    });

    if (!payout) {
      throw new Error('Payout not found');
    }

    // Delete the payout
    await prisma.payout.delete({
      where: { id },
    });

    // Note: We don't automatically unmark payments as unpaid since this could be complex
    // Admin should handle this manually if needed

    console.log(`✅ Payout ${id} deleted successfully`);
  }

  // ✅ ОБНОВЛЕНО: New method to get merchants awaiting payout (исключаем REFUND и CHARGEBACK)
  async getMerchantsAwaitingPayout(filters: MerchantsAwaitingPayoutFilters): Promise<{
    merchants: MerchantAwaitingPayout[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
    summary: {
      totalMerchants: number;
      totalAmountUSDT: number;
      totalAmountAfterCommissionUSDT: number;
    };
  }> {
    const { page, limit, minAmount, search } = filters;
    
    console.log('📋 Getting merchants awaiting payout with filters:', filters);

    // ✅ ОБНОВЛЕНО: Получаем только PAID платежи (исключаем REFUND и CHARGEBACK)
    const eligiblePayments = await prisma.payment.findMany({
      where: {
        status: 'PAID', // ✅ Только PAID платежи
        merchantPaid: false,
        paidAt: { not: null },
      },
      select: {
        id: true,
        shopId: true,
        amount: true,
        currency: true,
        gateway: true,
        paidAt: true,
        createdAt: true,
        shop: {
          select: {
            id: true,
            name: true,
            username: true,
            telegram: true,
            shopUrl: true,
            gatewaySettings: true,
            // Wallet fields
            usdtPolygonWallet: true,
            usdtTrcWallet: true,
            usdtErcWallet: true,
            usdcPolygonWallet: true,
          },
        },
      },
    });

    console.log(`💰 Found ${eligiblePayments.length} eligible PAID payments for payout analysis`);

    // Group payments by shop and calculate amounts
    const merchantsMap = new Map<string, {
      shop: any;
      payments: Array<{
        id: string;
        amount: number;
        currency: string;
        gateway: string;
        paidAt: Date;
        createdAt: Date;
        amountUSDT: number;
        commission: number;
        amountAfterCommissionUSDT: number;
        isEligible: boolean;
      }>;
    }>();

    // Process each payment
    for (const payment of eligiblePayments) {
      const paymentForCheck = {
        ...payment,
        status: 'PAID',
        merchantPaid: false,
        shop: { gatewaySettings: payment.shop.gatewaySettings },
      } as PaymentForPayout;

      const isEligible = this.isEligibleForPayout(paymentForCheck);
      
      // Only include eligible payments
      if (!isEligible) continue;

      // Convert amount to USDT
      const amountUSDT = await currencyService.convertToUSDT(payment.amount, payment.currency);
      
      // Get gateway-specific commission
      const gatewayConfig = this.getGatewaySettings(payment.shop, payment.gateway);
      const amountAfterCommissionUSDT = this.calculateAmountAfterCommission(amountUSDT, gatewayConfig.commission);

      const shopId = payment.shopId;
      
      if (!merchantsMap.has(shopId)) {
        merchantsMap.set(shopId, {
          shop: payment.shop,
          payments: [],
        });
      }

      merchantsMap.get(shopId)!.payments.push({
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        gateway: payment.gateway,
        paidAt: payment.paidAt!,
        createdAt: payment.createdAt,
        amountUSDT,
        commission: gatewayConfig.commission,
        amountAfterCommissionUSDT,
        isEligible: true,
      });
    }

    console.log(`🏪 Found ${merchantsMap.size} merchants with eligible PAID payments`);

    // Convert to array and calculate totals
    const merchantsData: MerchantAwaitingPayout[] = [];

    for (const [shopId, data] of merchantsMap) {
      const { shop, payments } = data;

      // Calculate totals
      const totalAmountUSDT = payments.reduce((sum, p) => sum + p.amountUSDT, 0);
      const totalAmountAfterCommissionUSDT = payments.reduce((sum, p) => sum + p.amountAfterCommissionUSDT, 0);

      // Apply minimum amount filter
      if (minAmount && totalAmountAfterCommissionUSDT < minAmount) {
        continue;
      }

      // Apply search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch = 
          shop.name.toLowerCase().includes(searchLower) ||
          shop.username.toLowerCase().includes(searchLower) ||
          (shop.telegram && shop.telegram.toLowerCase().includes(searchLower));
        
        if (!matchesSearch) {
          continue;
        }
      }

      // Calculate gateway breakdown
      const gatewayMap = new Map<string, {
        count: number;
        amountUSDT: number;
        amountAfterCommissionUSDT: number;
        commission: number;
      }>();

      for (const payment of payments) {
        const gateway = payment.gateway;
        
        if (!gatewayMap.has(gateway)) {
          gatewayMap.set(gateway, {
            count: 0,
            amountUSDT: 0,
            amountAfterCommissionUSDT: 0,
            commission: payment.commission,
          });
        }

        const gatewayData = gatewayMap.get(gateway)!;
        gatewayData.count++;
        gatewayData.amountUSDT += payment.amountUSDT;
        gatewayData.amountAfterCommissionUSDT += payment.amountAfterCommissionUSDT;
      }

      const gatewayBreakdown = Array.from(gatewayMap.entries()).map(([gateway, data]) => ({
        gateway: gateway.charAt(0).toUpperCase() + gateway.slice(1), // Capitalize
        count: data.count,
        amountUSDT: Math.round(data.amountUSDT * 100) / 100,
        amountAfterCommissionUSDT: Math.round(data.amountAfterCommissionUSDT * 100) / 100,
        commission: data.commission,
      }));

      // Find oldest payment date
      const oldestPaymentDate = payments.reduce((oldest, payment) => {
        return payment.paidAt < oldest ? payment.paidAt : oldest;
      }, payments[0].paidAt);

      merchantsData.push({
        id: shop.id,
        fullName: shop.name,
        username: shop.username,
        telegramId: shop.telegram,
        merchantUrl: shop.shopUrl,
        wallets: {
          usdtPolygonWallet: shop.usdtPolygonWallet,
          usdtTrcWallet: shop.usdtTrcWallet,
          usdtErcWallet: shop.usdtErcWallet,
          usdcPolygonWallet: shop.usdcPolygonWallet,
        },
        totalAmountUSDT: Math.round(totalAmountUSDT * 100) / 100,
        totalAmountAfterCommissionUSDT: Math.round(totalAmountAfterCommissionUSDT * 100) / 100,
        paymentsCount: payments.length,
        oldestPaymentDate,
        gatewayBreakdown,
      });
    }

    // Sort by total amount (descending)
    merchantsData.sort((a, b) => b.totalAmountAfterCommissionUSDT - a.totalAmountAfterCommissionUSDT);

    // Calculate summary
    const totalMerchants = merchantsData.length;
    const totalAmountUSDT = merchantsData.reduce((sum, m) => sum + m.totalAmountUSDT, 0);
    const totalAmountAfterCommissionUSDT = merchantsData.reduce((sum, m) => sum + m.totalAmountAfterCommissionUSDT, 0);

    // Apply pagination
    const skip = (page - 1) * limit;
    const paginatedMerchants = merchantsData.slice(skip, skip + limit);

    console.log(`✅ Returning ${paginatedMerchants.length} merchants out of ${totalMerchants} total`);
    console.log(`💰 Total amount: ${totalAmountUSDT.toFixed(2)} USDT (${totalAmountAfterCommissionUSDT.toFixed(2)} USDT after commission)`);

    return {
      merchants: paginatedMerchants,
      pagination: {
        page,
        limit,
        total: totalMerchants,
        totalPages: Math.ceil(totalMerchants / limit),
      },
      summary: {
        totalMerchants,
        totalAmountUSDT: Math.round(totalAmountUSDT * 100) / 100,
        totalAmountAfterCommissionUSDT: Math.round(totalAmountAfterCommissionUSDT * 100) / 100,
      },
    };
  }

  // ✅ ОБНОВЛЕНО: New method to get payout statistics (учитывает chargeback штрафы в USDT)
  async getPayoutStats(): Promise<PayoutStats> {
    console.log('📊 Calculating admin payout statistics...');

    // ✅ ОБНОВЛЕНО: Получаем все платежи включая REFUND и CHARGEBACK
    const allPayments = await prisma.payment.findMany({
      where: {
        status: { in: ['PAID', 'REFUND', 'CHARGEBACK'] }, // ✅ Включаем все статусы для анализа
      },
      select: {
        id: true,
        shopId: true,
        amount: true,
        currency: true,
        status: true,
        gateway: true,
        paidAt: true,
        merchantPaid: true,
        createdAt: true,
        chargebackAmount: true, // ✅ ДОБАВЛЕНО: Сумма штрафа в USDT
        shop: {
          select: {
            gatewaySettings: true,
          },
        },
      },
    }) as PaymentForPayout[];

    console.log(`💰 Found ${allPayments.length} payments for analysis (PAID/REFUND/CHARGEBACK)`);

    // Calculate current month boundaries
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    let totalPayoutUSDT = 0;
    let awaitingPayoutUSDT = 0;
    let thisMonthUSDT = 0;
    let availableBalanceUSDT = 0;

    // Process each payment
    for (const payment of allPayments) {
      // ✅ ОБНОВЛЕНО: Используем новую логику расчета эффективной суммы
      const effectiveAmount = this.calculateEffectiveAmount(payment);
      
      if (effectiveAmount === 0) {
        continue; // Пропускаем REFUND и другие нулевые платежи
      }

      let amountUSDT: number;
      let amountAfterCommission: number;

      if (payment.status === 'CHARGEBACK') {
        // ✅ ИСПРАВЛЕНО: Для чарджбэка используем сумму штрафа (уже в USDT, отрицательная)
        amountUSDT = Math.abs(effectiveAmount); // Штраф уже в USDT
        amountAfterCommission = -amountUSDT; // Отрицательное влияние
      } else {
        // ✅ Для обычных PAID платежей
        amountUSDT = await currencyService.convertToUSDT(payment.amount, payment.currency);
        
        // Get gateway-specific commission
        const gatewayConfig = this.getGatewaySettings(payment.shop, payment.gateway);
        amountAfterCommission = this.calculateAmountAfterCommission(amountUSDT, gatewayConfig.commission);
      }

      // TotalPayout: все оплаченные мерчанту транзакции (merchant_paid = true)
      if (payment.merchantPaid) {
        totalPayoutUSDT += amountAfterCommission;

        // ThisMonth: выплаты в текущем месяце
        if (payment.paidAt && payment.paidAt >= startOfMonth && payment.paidAt <= endOfMonth) {
          thisMonthUSDT += amountAfterCommission;
        }
      }

      // AwaitingPayout: только для PAID платежей (eligible for payout)
      if (payment.status === 'PAID' && this.isEligibleForPayout(payment)) {
        awaitingPayoutUSDT += amountAfterCommission;
        availableBalanceUSDT += amountUSDT; // Без вычета комиссии для AvailableBalance
      }
    }

    const stats: PayoutStats = {
      totalPayout: Math.round(totalPayoutUSDT * 100) / 100,
      awaitingPayout: Math.round(awaitingPayoutUSDT * 100) / 100,
      thisMonth: Math.round(thisMonthUSDT * 100) / 100,
      availableBalance: Math.round(availableBalanceUSDT * 100) / 100,
    };

    console.log('✅ Payout statistics calculated:');
    console.log(`💸 Total Payout: ${stats.totalPayout} USDT (включая штрафы chargeback)`);
    console.log(`⏳ Awaiting Payout: ${stats.awaitingPayout} USDT (только PAID платежи)`);
    console.log(`📅 This Month: ${stats.thisMonth} USDT`);
    console.log(`💰 Available Balance: ${stats.availableBalance} USDT`);

    return stats;
  }

  // ✅ ОБНОВЛЕНО: System statistics с учетом chargeback штрафов в USDT
  async getSystemStatistics(period: string): Promise<AdminStatistics> {
    const periodDays = this.getPeriodDays(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    console.log(`📊 Generating admin statistics for period: ${period} (${periodDays} days)`);

    // Get total users (shops)
    const totalUsers = await prisma.shop.count({
      where: {
        status: 'ACTIVE',
      },
    });

    // Get total payments count
    const totalPayments = await prisma.payment.count();

    // ✅ ОБНОВЛЕНО: Получаем все платежи включая REFUND и CHARGEBACK для расчета revenue
    const allPayments = await prisma.payment.findMany({
      where: {
        status: { in: ['PAID', 'REFUND', 'CHARGEBACK'] },
      },
      select: {
        amount: true,
        currency: true,
        status: true,
        chargebackAmount: true, // ✅ ДОБАВЛЕНО: Сумма штрафа в USDT
        createdAt: true,
      },
    });

    console.log(`💰 Found ${allPayments.length} payments for revenue calculation (PAID/REFUND/CHARGEBACK)`);

    // ✅ ОБНОВЛЕНО: Convert all payments to USDT with new logic
    const paymentsInUSDT = await Promise.all(
      allPayments.map(async (payment) => {
        const effectiveAmount = this.calculateEffectiveAmount(payment);
        
        if (effectiveAmount === 0) {
          return {
            amount: 0,
            createdAt: payment.createdAt,
          };
        }

        let usdtAmount: number;
        
        if (payment.status === 'CHARGEBACK') {
          // ✅ ИСПРАВЛЕНО: Для чарджбэка используем сумму штрафа (уже в USDT, отрицательная)
          usdtAmount = -Math.abs(effectiveAmount); // Штраф уже в USDT
        } else {
          // Для обычных PAID платежей
          usdtAmount = await currencyService.convertToUSDT(payment.amount, payment.currency);
        }

        return {
          amount: usdtAmount,
          createdAt: payment.createdAt,
        };
      })
    );

    const totalRevenue = paymentsInUSDT.reduce((sum, payment) => sum + payment.amount, 0);
    const averagePayment = totalPayments > 0 ? totalRevenue / totalPayments : 0;

    console.log(`💵 Total revenue: ${totalRevenue.toFixed(2)} USDT (включая штрафы chargeback)`);
    console.log(`📈 Average payment: ${averagePayment.toFixed(2)} USDT`);

    // ✅ ОБНОВЛЕНО: Get daily statistics with new logic
    const dailyStats = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        array_agg(
          json_build_object(
            'amount', amount,
            'currency', currency,
            'status', status,
            'chargeback_amount', chargeback_amount
          )
        ) as payments
      FROM payments 
      WHERE created_at >= ${startDate}
        AND status IN ('PAID', 'REFUND', 'CHARGEBACK')
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    ` as Array<{ 
      date: Date; 
      payments: Array<{ 
        amount: number; 
        currency: string; 
        status: string; 
        chargeback_amount?: number;
      }> 
    }>;

    console.log(`📅 Processing daily stats for ${dailyStats.length} days`);

    // ✅ ОБНОВЛЕНО: Process daily stats with new logic
    const dailyStatsProcessed = await Promise.all(
      dailyStats.map(async (stat) => {
        const dailyPaymentsUSDT = await Promise.all(
          stat.payments.map(async (payment) => {
            const effectiveAmount = this.calculateEffectiveAmount(payment);
            
            if (effectiveAmount === 0) {
              return 0;
            }

            if (payment.status === 'CHARGEBACK') {
              // ✅ ИСПРАВЛЕНО: Для чарджбэка используем сумму штрафа (уже в USDT, отрицательная)
              return -Math.abs(effectiveAmount); // Штраф уже в USDT
            } else {
              // Для обычных PAID платежей
              return await currencyService.convertToUSDT(payment.amount, payment.currency);
            }
          })
        );

        const dailyRevenueUSDT = dailyPaymentsUSDT.reduce((sum, amount) => sum + amount, 0);

        return {
          date: stat.date.toISOString().split('T')[0],
          amount: dailyRevenueUSDT,
        };
      })
    );

    // Generate complete date range for the period
    const dateRange = this.generateDateRange(startDate, new Date());
    
    // Create map for quick lookup
    const dailyStatsMap = new Map(
      dailyStatsProcessed.map(stat => [stat.date, stat.amount])
    );

    // Fill in missing dates with zero values
    const dailyRevenue = dateRange.map(date => ({
      date,
      amount: dailyStatsMap.get(date) || 0,
    }));

    console.log(`✅ Admin statistics generated successfully`);
    console.log(`👥 Total users: ${totalUsers}`);
    console.log(`💳 Total payments: ${totalPayments}`);
    console.log(`📊 Daily revenue entries: ${dailyRevenue.length}`);

    return {
      totalRevenue: Math.round(totalRevenue * 100) / 100, // Round to 2 decimal places
      totalUsers,
      totalPayments,
      averagePayment: Math.round(averagePayment * 100) / 100, // Round to 2 decimal places
      dailyRevenue,
    };
  }

  // New method to get all payments with filters and pagination
  async getAllPayments(filters: PaymentFilters): Promise<{
    payments: AdminPaymentResponse[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const { page, limit, status, gateway, shopId, dateFrom, dateTo, search } = filters;
    const skip = (page - 1) * limit;

    console.log(`📋 Getting payments with filters:`, filters);

    // Build where clause
    const where: any = {};
    
    if (status) {
      where.status = status.toUpperCase();
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

    if (shopId) {
      where.shopId = shopId;
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

    if (search) {
      where.OR = [
        { orderId: { contains: search, mode: 'insensitive' } },
        { gatewayOrderId: { contains: search, mode: 'insensitive' } }, // ✅ ДОБАВЛЕНО: поиск по gatewayOrderId
        { gatewayPaymentId: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { shop: { name: { contains: search, mode: 'insensitive' } } },
        { shop: { username: { contains: search, mode: 'insensitive' } } },
      ];
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
              id: true,
              name: true,
              username: true,
            },
          },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    console.log(`📊 Found ${payments.length} payments out of ${total} total`);

    const formattedPayments: AdminPaymentResponse[] = payments.map(payment => ({
      id: payment.id,
      shopId: payment.shopId,
      shopName: payment.shop.name,
      shopUsername: payment.shop.username,
      gateway: payment.gateway,
      orderId: payment.orderId,
      gatewayOrderId: payment.gatewayOrderId, // ✅ ДОБАВЛЕНО: ID который передается в шлюз
      amount: payment.amount,
      currency: payment.currency,
      sourceCurrency: payment.sourceCurrency,
      status: payment.status,
      usage: payment.usage,
      externalPaymentUrl: payment.externalPaymentUrl,
      gatewayPaymentId: payment.gatewayPaymentId,
      customerEmail: payment.customerEmail,
      customerName: payment.customerName,
      // Payment details
      cardLast4: payment.cardLast4,
      paymentMethod: payment.paymentMethod,
      bankId: payment.bankId,
      remitterIban: payment.remitterIban,
      remitterName: payment.remitterName,
      // ✅ ДОБАВЛЕНО: Поля для chargeback и refund
      chargebackAmount: payment.chargebackAmount,
      adminNotes: payment.adminNotes,
      statusChangedBy: payment.statusChangedBy,
      statusChangedAt: payment.statusChangedAt,
      // Timestamps
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      expiresAt: payment.expiresAt,
    }));

    return {
      payments: formattedPayments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // New method to get payment by ID
  async getPaymentById(id: string): Promise<AdminPaymentResponse | null> {
    console.log(`🔍 Getting payment by ID: ${id}`);

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        webhookLogs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            event: true,
            statusCode: true,
            retryCount: true,
            createdAt: true,
          },
        },
      },
    });

    if (!payment) {
      console.log(`❌ Payment not found: ${id}`);
      return null;
    }

    console.log(`✅ Found payment: ${payment.orderId} (${payment.status})`);

    return {
      id: payment.id,
      shopId: payment.shopId,
      shopName: payment.shop.name,
      shopUsername: payment.shop.username,
      gateway: payment.gateway,
      orderId: payment.orderId,
      gatewayOrderId: payment.gatewayOrderId, // ✅ ДОБАВЛЕНО: ID который передается в шлюз
      amount: payment.amount,
      currency: payment.currency,
      sourceCurrency: payment.sourceCurrency,
      status: payment.status,
      usage: payment.usage,
      externalPaymentUrl: payment.externalPaymentUrl,
      gatewayPaymentId: payment.gatewayPaymentId,
      customerEmail: payment.customerEmail,
      customerName: payment.customerName,
      // Payment details
      cardLast4: payment.cardLast4,
      paymentMethod: payment.paymentMethod,
      bankId: payment.bankId,
      remitterIban: payment.remitterIban,
      remitterName: payment.remitterName,
      // ✅ ДОБАВЛЕНО: Поля для chargeback и refund
      chargebackAmount: payment.chargebackAmount,
      adminNotes: payment.adminNotes,
      statusChangedBy: payment.statusChangedBy,
      statusChangedAt: payment.statusChangedAt,
      // Timestamps
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      expiresAt: payment.expiresAt,
      // Include webhook logs for admin
      webhookLogs: payment.webhookLogs,
    } as any;
  }

  // ✅ ОБНОВЛЕНО: New method to update payment status without admin mention
  async updatePaymentStatus(id: string, status: string, notes?: string, chargebackAmount?: number): Promise<AdminPaymentResponse> {
    console.log(`🔄 Updating payment ${id} status to: ${status}`);

    const validStatuses = ['PENDING', 'PROCESSING', 'PAID', 'EXPIRED', 'FAILED', 'REFUND', 'CHARGEBACK'];
    if (!validStatuses.includes(status.toUpperCase())) {
      throw new Error(`Invalid status. Valid statuses: ${validStatuses.join(', ')}`);
    }

    const payment = await prisma.payment.findUnique({
      where: { id },
      select: { id: true, status: true, orderId: true },
    });

    if (!payment) {
      throw new Error('Payment not found');
    }

    // ✅ ОБНОВЛЕНО: Валидация для chargeback (сумма штрафа в USDT)
    if (status.toUpperCase() === 'CHARGEBACK') {
      if (!chargebackAmount || chargebackAmount <= 0) {
        throw new Error('Chargeback amount is required and must be positive (amount in USDT)');
      }
      console.log(`💸 Chargeback amount: ${chargebackAmount} USDT (penalty amount)`);
    }

    // ✅ ОБНОВЛЕНО: Подготавливаем данные для обновления БЕЗ упоминания админа
    const updateData: any = {
      status: status.toUpperCase() as any,
      updatedAt: new Date(),
      // ✅ УБРАНО: Не указываем что изменение сделано админом
      // statusChangedBy: 'admin',
      // statusChangedAt: new Date(),
    };

    // ✅ ДОБАВЛЕНО: Добавляем заметки если есть
    if (notes) {
      updateData.adminNotes = notes;
    }

    // ✅ ОБНОВЛЕНО: Добавляем сумму штрафа для chargeback (в USDT)
    if (status.toUpperCase() === 'CHARGEBACK' && chargebackAmount) {
      updateData.chargebackAmount = chargebackAmount; // Сумма штрафа в USDT
    }

    const updatedPayment = await prisma.payment.update({
      where: { id },
      data: updateData,
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    // ✅ ОБНОВЛЕНО: Log the action without mentioning admin
    await prisma.webhookLog.create({
      data: {
        paymentId: id,
        shopId: updatedPayment.shopId,
        event: 'status_update',
        statusCode: 200,
        responseBody: JSON.stringify({
          oldStatus: payment.status,
          newStatus: status.toUpperCase(),
          notes: notes || null,
          chargebackAmount: chargebackAmount || null,
          timestamp: new Date().toISOString(),
        }),
      },
    });

    console.log(`✅ Payment ${payment.orderId} status updated from ${payment.status} to ${status.toUpperCase()}`);
    
    // ✅ ОБНОВЛЕНО: Логируем дополнительную информацию для chargeback
    if (status.toUpperCase() === 'CHARGEBACK') {
      console.log(`💸 Chargeback penalty: ${chargebackAmount} USDT (will be deducted from merchant balance)`);
    }

    return {
      id: updatedPayment.id,
      shopId: updatedPayment.shopId,
      shopName: updatedPayment.shop.name,
      shopUsername: updatedPayment.shop.username,
      gateway: updatedPayment.gateway,
      orderId: updatedPayment.orderId,
      gatewayOrderId: updatedPayment.gatewayOrderId, // ✅ ДОБАВЛЕНО: ID который передается в шлюз
      amount: updatedPayment.amount,
      currency: updatedPayment.currency,
      sourceCurrency: updatedPayment.sourceCurrency,
      status: updatedPayment.status,
      usage: updatedPayment.usage,
      externalPaymentUrl: updatedPayment.externalPaymentUrl,
      gatewayPaymentId: updatedPayment.gatewayPaymentId,
      customerEmail: updatedPayment.customerEmail,
      customerName: updatedPayment.customerName,
      // Payment details
      cardLast4: updatedPayment.cardLast4,
      paymentMethod: updatedPayment.paymentMethod,
      bankId: updatedPayment.bankId,
      remitterIban: updatedPayment.remitterIban,
      remitterName: updatedPayment.remitterName,
      // ✅ ДОБАВЛЕНО: Поля для chargeback и refund
      chargebackAmount: updatedPayment.chargebackAmount,
      adminNotes: updatedPayment.adminNotes,
      statusChangedBy: updatedPayment.statusChangedBy,
      statusChangedAt: updatedPayment.statusChangedAt,
      // Timestamps
      createdAt: updatedPayment.createdAt,
      updatedAt: updatedPayment.updatedAt,
      expiresAt: updatedPayment.expiresAt,
    };
  }

  // Updated method with pagination and filters
  async getAllUsers(filters: UserFilters): Promise<{
    users: UserResponse[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const { page, limit, status } = filters;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};
    
    if (status) {
      where.status = status.toUpperCase();
    }

    console.log(`📋 Getting users with filters:`, { page, limit, status, where });

    const [users, total] = await Promise.all([
      prisma.shop.findMany({
        where,
        skip,
        take: limit,
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
        orderBy: {
          createdAt: 'desc',
        },
      }),
      prisma.shop.count({ where }),
    ]);

    console.log(`📊 Found ${users.length} users out of ${total} total`);

    const formattedUsers: UserResponse[] = users.map(user => ({
      id: user.id,
      fullName: user.name,
      username: user.username,
      telegramId: user.telegram,
      merchantUrl: user.shopUrl,
      gateways: user.paymentGateways ? JSON.parse(user.paymentGateways) : null,
      gatewaySettings: user.gatewaySettings ? JSON.parse(user.gatewaySettings) : null,
      publicKey: user.publicKey,
      // Wallet fields
      wallets: {
        usdtPolygonWallet: user.usdtPolygonWallet,
        usdtTrcWallet: user.usdtTrcWallet,
        usdtErcWallet: user.usdtErcWallet,
        usdcPolygonWallet: user.usdcPolygonWallet,
      },
      status: user.status,
      createdAt: user.createdAt,
    }));

    return {
      users: formattedUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserById(id: string): Promise<UserResponse | null> {
    return await this.userService.getUserById(id);
  }

  async createUser(userData: CreateUserRequest): Promise<UserResponse> {
    return await this.userService.createUser(userData);
  }

  async updateUser(id: string, updateData: UpdateUserRequest): Promise<UserResponse> {
    return await this.userService.updateUser(id, updateData);
  }

  async deleteUser(id: string): Promise<void> {
    return await this.userService.deleteUser(id);
  }

  // New method to suspend user
  async suspendUser(id: string): Promise<UserResponse> {
    console.log(`🚫 Suspending user: ${id}`);
    
    const user = await prisma.shop.findUnique({
      where: { id },
      select: { id: true, username: true, status: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    if (user.status === 'SUSPENDED') {
      throw new Error('User is already suspended');
    }

    const updatedUser = await this.userService.updateUser(id, { status: 'SUSPENDED' });
    
    console.log(`✅ User ${user.username} suspended successfully`);
    return updatedUser;
  }

  // New method to activate user (unsuspend)
  async activateUser(id: string): Promise<UserResponse> {
    console.log(`✅ Activating user: ${id}`);
    
    const user = await prisma.shop.findUnique({
      where: { id },
      select: { id: true, username: true, status: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    if (user.status === 'ACTIVE') {
      throw new Error('User is already active');
    }

    const updatedUser = await this.userService.updateUser(id, { status: 'ACTIVE' });
    
    console.log(`✅ User ${user.username} activated successfully`);
    return updatedUser;
  }
}
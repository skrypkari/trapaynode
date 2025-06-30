import prisma from '../config/database';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { currencyService } from './currencyService';
import { 
  PayoutStats, 
  MerchantAwaitingPayout, 
  MerchantsAwaitingPayoutFilters,
  CreatePayoutRequest,
  PayoutResponse,
  PayoutFilters,
  MerchantStatisticsFilters,
  MerchantStatistics
} from '../types/admin';
import { CreateUserRequest, UserResponse, UpdateUserRequest } from '../types/user';

export class AdminService {
  // ✅ ОБНОВЛЕНО: Исправлен расчет заработка шлюза
  async getMerchantStatistics(filters: MerchantStatisticsFilters): Promise<MerchantStatistics> {
    console.log('📊 Getting merchant statistics with filters:', filters);

    // Определяем период
    let dateFrom: Date;
    let dateTo: Date;
    const now = new Date();

    switch (filters.period) {
      case 'all':
        dateFrom = new Date('2020-01-01'); // Начало времен
        dateTo = now;
        break;
      case 'year':
        dateFrom = new Date(now.getFullYear(), 0, 1); // Начало текущего года
        dateTo = now;
        break;
      case 'month':
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1); // Начало текущего месяца
        dateTo = now;
        break;
      case 'week':
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay()); // Начало недели (воскресенье)
        startOfWeek.setHours(0, 0, 0, 0);
        dateFrom = startOfWeek;
        dateTo = now;
        break;
      case 'custom':
        if (!filters.dateFrom || !filters.dateTo) {
          throw new Error('dateFrom and dateTo are required for custom period');
        }
        dateFrom = new Date(filters.dateFrom);
        dateTo = new Date(filters.dateTo);
        break;
      default:
        // По умолчанию - текущий месяц
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        dateTo = now;
        break;
    }

    console.log(`📅 Period: ${dateFrom.toISOString()} - ${dateTo.toISOString()}`);

    // Базовые условия для запросов
    const baseWhere: any = {
      status: 'PAID',
      paidAt: {
        gte: dateFrom,
        lte: dateTo,
      },
    };

    // Добавляем фильтр по мерчанту если указан
    if (filters.shopId) {
      baseWhere.shopId = filters.shopId;
    }

    // Получаем все успешные платежи за период
    const payments = await prisma.payment.findMany({
      where: baseWhere,
      select: {
        id: true,
        shopId: true,
        amount: true,
        currency: true,
        gateway: true,
        paidAt: true,
        shop: {
          select: {
            id: true,
            name: true,
            username: true,
            gatewaySettings: true,
          },
        },
      },
    });

    console.log(`💰 Found ${payments.length} successful payments`);

    // Получаем все выплаты за период
    const payoutsWhere: any = {
      status: 'COMPLETED',
      paidAt: {
        gte: dateFrom,
        lte: dateTo,
      },
    };

    if (filters.shopId) {
      payoutsWhere.shopId = filters.shopId;
    }

    const payouts = await prisma.payout.findMany({
      where: payoutsWhere,
      select: {
        shopId: true,
        amount: true,
        paidAt: true,
        shop: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    console.log(`💸 Found ${payouts.length} completed payouts`);

    // Конвертируем все суммы в USDT и рассчитываем метрики
    let totalTurnoverUSDT = 0;
    let totalCommissionUSDT = 0;
    const gatewayStats: Record<string, {
      paymentsCount: number;
      turnoverUSDT: number;
      commissionUSDT: number;
      merchantEarningsUSDT: number;
      totalCommissionRate: number;
      paymentsWithCommission: number;
    }> = {};

    const merchantStats: Record<string, {
      shopId: string;
      shopName: string;
      shopUsername: string;
      paymentsCount: number;
      turnoverUSDT: number;
      commissionUSDT: number;
      merchantEarningsUSDT: number;
    }> = {};

    const dailyStats: Record<string, {
      turnover: number;
      merchantEarnings: number;
      gatewayEarnings: number;
      paymentsCount: number;
    }> = {};

    // Обрабатываем платежи
    for (const payment of payments) {
      // Конвертируем в USDT
      const amountUSDT = await currencyService.convertToUSDT(payment.amount, payment.currency);
      totalTurnoverUSDT += amountUSDT;

      // Получаем настройки комиссии для шлюза
      let commissionRate = 10; // По умолчанию 10%
      
      if (payment.shop.gatewaySettings) {
        try {
          const gatewaySettings = JSON.parse(payment.shop.gatewaySettings);
          const gatewayDisplayName = this.getGatewayDisplayName(payment.gateway);
          
          if (gatewaySettings[gatewayDisplayName]?.commission !== undefined) {
            commissionRate = gatewaySettings[gatewayDisplayName].commission;
          }
        } catch (error) {
          console.error('Error parsing gateway settings:', error);
        }
      }

      const commissionUSDT = amountUSDT * (commissionRate / 100);
      const merchantEarningsUSDT = amountUSDT - commissionUSDT;
      
      totalCommissionUSDT += commissionUSDT;

      // Статистика по шлюзам
      if (!gatewayStats[payment.gateway]) {
        gatewayStats[payment.gateway] = {
          paymentsCount: 0,
          turnoverUSDT: 0,
          commissionUSDT: 0,
          merchantEarningsUSDT: 0,
          totalCommissionRate: 0,
          paymentsWithCommission: 0,
        };
      }

      gatewayStats[payment.gateway].paymentsCount++;
      gatewayStats[payment.gateway].turnoverUSDT += amountUSDT;
      gatewayStats[payment.gateway].commissionUSDT += commissionUSDT;
      gatewayStats[payment.gateway].merchantEarningsUSDT += merchantEarningsUSDT;
      gatewayStats[payment.gateway].totalCommissionRate += commissionRate;
      gatewayStats[payment.gateway].paymentsWithCommission++;

      // Статистика по мерчантам (только если не выбран конкретный мерчант)
      if (!filters.shopId) {
        if (!merchantStats[payment.shopId]) {
          merchantStats[payment.shopId] = {
            shopId: payment.shopId,
            shopName: payment.shop.name,
            shopUsername: payment.shop.username,
            paymentsCount: 0,
            turnoverUSDT: 0,
            commissionUSDT: 0,
            merchantEarningsUSDT: 0,
          };
        }

        merchantStats[payment.shopId].paymentsCount++;
        merchantStats[payment.shopId].turnoverUSDT += amountUSDT;
        merchantStats[payment.shopId].commissionUSDT += commissionUSDT;
        merchantStats[payment.shopId].merchantEarningsUSDT += merchantEarningsUSDT;
      }

      // Дневная статистика
      const dateKey = payment.paidAt!.toISOString().split('T')[0];
      if (!dailyStats[dateKey]) {
        dailyStats[dateKey] = {
          turnover: 0,
          merchantEarnings: 0,
          gatewayEarnings: 0,
          paymentsCount: 0,
        };
      }

      dailyStats[dateKey].turnover += amountUSDT;
      dailyStats[dateKey].merchantEarnings += merchantEarningsUSDT;
      dailyStats[dateKey].gatewayEarnings += commissionUSDT;
      dailyStats[dateKey].paymentsCount++;
    }

    // Рассчитываем общую сумму выплат в USDT
    let totalPaidOutUSDT = 0;
    const merchantPayouts: Record<string, number> = {};

    for (const payout of payouts) {
      totalPaidOutUSDT += payout.amount; // Выплаты уже в USDT
      
      if (!merchantPayouts[payout.shopId]) {
        merchantPayouts[payout.shopId] = 0;
      }
      merchantPayouts[payout.shopId] += payout.amount;
    }

    // ✅ ИСПРАВЛЕНО: Заработано шлюзом = Оборот - Выплачено мерчанту
    const gatewayEarningsUSDT = totalTurnoverUSDT - totalPaidOutUSDT;
    const merchantEarningsUSDT = totalTurnoverUSDT - totalCommissionUSDT;

    // Добавляем информацию о выплатах к статистике мерчантов
    for (const shopId in merchantStats) {
      merchantStats[shopId].paidOutUSDT = merchantPayouts[shopId] || 0;
      merchantStats[shopId].averageCheckUSDT = merchantStats[shopId].paymentsCount > 0 
        ? merchantStats[shopId].turnoverUSDT / merchantStats[shopId].paymentsCount 
        : 0;
    }

    // Формируем результат
    const result: MerchantStatistics = {
      // Основные метрики
      totalTurnover: Math.round(totalTurnoverUSDT * 100) / 100,
      merchantEarnings: Math.round(merchantEarningsUSDT * 100) / 100,
      gatewayEarnings: Math.round(gatewayEarningsUSDT * 100) / 100, // ✅ ИСПРАВЛЕНО
      totalPaidOut: Math.round(totalPaidOutUSDT * 100) / 100,
      averageCheck: payments.length > 0 ? Math.round((totalTurnoverUSDT / payments.length) * 100) / 100 : 0,
      
      // Дополнительная информация
      totalPayments: payments.length,
      successfulPayments: payments.length, // Все платежи уже успешные (PAID)
      conversionRate: 100, // 100% так как мы считаем только успешные платежи
      
      // Разбивка по шлюзам
      gatewayBreakdown: Object.entries(gatewayStats).map(([gateway, stats]) => ({
        gateway,
        gatewayDisplayName: this.getGatewayDisplayName(gateway),
        paymentsCount: stats.paymentsCount,
        turnoverUSDT: Math.round(stats.turnoverUSDT * 100) / 100,
        commissionUSDT: Math.round(stats.commissionUSDT * 100) / 100,
        merchantEarningsUSDT: Math.round(stats.merchantEarningsUSDT * 100) / 100,
        averageCommissionRate: stats.paymentsWithCommission > 0 
          ? Math.round((stats.totalCommissionRate / stats.paymentsWithCommission) * 100) / 100 
          : 0,
      })),
      
      // Разбивка по мерчантам (только если не выбран конкретный мерчант)
      merchantBreakdown: filters.shopId ? undefined : Object.values(merchantStats).map(stats => ({
        shopId: stats.shopId,
        shopName: stats.shopName,
        shopUsername: stats.shopUsername,
        paymentsCount: stats.paymentsCount,
        turnoverUSDT: Math.round(stats.turnoverUSDT * 100) / 100,
        commissionUSDT: Math.round(stats.commissionUSDT * 100) / 100,
        merchantEarningsUSDT: Math.round(stats.merchantEarningsUSDT * 100) / 100,
        paidOutUSDT: Math.round((merchantPayouts[stats.shopId] || 0) * 100) / 100,
        averageCheckUSDT: Math.round((stats.turnoverUSDT / stats.paymentsCount) * 100) / 100,
      })),
      
      // Временные данные для графиков
      dailyData: Object.entries(dailyStats)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, stats]) => ({
          date,
          turnover: Math.round(stats.turnover * 100) / 100,
          merchantEarnings: Math.round(stats.merchantEarnings * 100) / 100,
          gatewayEarnings: Math.round(stats.gatewayEarnings * 100) / 100,
          paymentsCount: stats.paymentsCount,
        })),
      
      // Период анализа
      periodInfo: {
        from: dateFrom,
        to: dateTo,
        periodType: filters.period || 'month',
        daysCount: Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)),
      },
    };

    console.log('📊 Merchant statistics calculated:', {
      totalTurnover: result.totalTurnover,
      merchantEarnings: result.merchantEarnings,
      gatewayEarnings: result.gatewayEarnings,
      totalPaidOut: result.totalPaidOut,
      paymentsCount: result.totalPayments,
    });

    return result;
  }

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

  async getSystemStatistics(period: string = '30d'): Promise<any> {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const [
      totalShops,
      activeShops,
      totalPayments,
      successfulPayments,
      totalRevenue,
      recentPayments,
    ] = await Promise.all([
      prisma.shop.count(),
      prisma.shop.count({ where: { status: 'ACTIVE' } }),
      prisma.payment.count({
        where: { createdAt: { gte: startDate } },
      }),
      prisma.payment.count({
        where: {
          status: 'PAID',
          createdAt: { gte: startDate },
        },
      }),
      prisma.payment.findMany({
        where: {
          status: 'PAID',
          createdAt: { gte: startDate },
        },
        select: {
          amount: true,
          currency: true,
        },
      }),
      prisma.payment.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        where: { createdAt: { gte: startDate } },
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          gateway: true,
          createdAt: true,
          shop: {
            select: {
              name: true,
              username: true,
            },
          },
        },
      }),
    ]);

    // Calculate total revenue in USDT
    let totalRevenueUSDT = 0;
    for (const payment of totalRevenue) {
      const usdtAmount = await currencyService.convertToUSDT(payment.amount, payment.currency);
      totalRevenueUSDT += usdtAmount;
    }

    const conversionRate = totalPayments > 0 ? (successfulPayments / totalPayments) * 100 : 0;

    return {
      overview: {
        totalShops,
        activeShops,
        totalPayments,
        successfulPayments,
        totalRevenue: Math.round(totalRevenueUSDT * 100) / 100,
        conversionRate: Math.round(conversionRate * 100) / 100,
      },
      recentPayments: recentPayments.map(payment => ({
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        gateway: payment.gateway,
        shopName: payment.shop.name,
        shopUsername: payment.shop.username,
        createdAt: payment.createdAt,
      })),
      period,
    };
  }

  async getPayoutStats(): Promise<PayoutStats> {
    // Get all paid payments that haven't been paid out to merchants yet
    const unpaidPayments = await prisma.payment.findMany({
      where: {
        status: 'PAID',
        merchantPaid: false,
        paidAt: { not: null },
      },
      select: {
        id: true,
        shopId: true,
        amount: true,
        currency: true,
        gateway: true,
        shop: {
          select: {
            gatewaySettings: true,
          },
        },
      },
    });

    // Calculate awaiting payout amount with commission deduction
    let awaitingPayoutUSDT = 0;
    let availableBalanceUSDT = 0;

    for (const payment of unpaidPayments) {
      const amountUSDT = await currencyService.convertToUSDT(payment.amount, payment.currency);
      availableBalanceUSDT += amountUSDT;

      // Calculate commission
      let commissionRate = 10; // Default 10%
      
      if (payment.shop.gatewaySettings) {
        try {
          const gatewaySettings = JSON.parse(payment.shop.gatewaySettings);
          const gatewayDisplayName = this.getGatewayDisplayName(payment.gateway);
          
          if (gatewaySettings[gatewayDisplayName]?.commission !== undefined) {
            commissionRate = gatewaySettings[gatewayDisplayName].commission;
          }
        } catch (error) {
          console.error('Error parsing gateway settings:', error);
        }
      }

      const merchantAmount = amountUSDT * (1 - commissionRate / 100);
      awaitingPayoutUSDT += merchantAmount;
    }

    // Get total payouts
    const [totalPayouts, thisMonthPayouts] = await Promise.all([
      prisma.payout.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      prisma.payout.aggregate({
        where: {
          status: 'COMPLETED',
          paidAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalPayout: totalPayouts._sum.amount || 0,
      awaitingPayout: Math.round(awaitingPayoutUSDT * 100) / 100,
      thisMonth: thisMonthPayouts._sum.amount || 0,
      availableBalance: Math.round(availableBalanceUSDT * 100) / 100,
    };
  }

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

    // Get all paid payments that haven't been paid out to merchants yet
    const unpaidPayments = await prisma.payment.findMany({
      where: {
        status: 'PAID',
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
        shop: {
          select: {
            id: true,
            name: true,
            username: true,
            telegram: true,
            shopUrl: true,
            usdtPolygonWallet: true,
            usdtTrcWallet: true,
            usdtErcWallet: true,
            usdcPolygonWallet: true,
            gatewaySettings: true,
          },
        },
      },
    });

    // Group payments by shop and calculate amounts
    const merchantData: Record<string, {
      shop: any;
      payments: any[];
      totalAmountUSDT: number;
      totalAmountAfterCommissionUSDT: number;
      gatewayBreakdown: Record<string, {
        gateway: string;
        count: number;
        amountUSDT: number;
        amountAfterCommissionUSDT: number;
        commission: number;
      }>;
      oldestPaymentDate: Date;
    }> = {};

    for (const payment of unpaidPayments) {
      if (!merchantData[payment.shopId]) {
        merchantData[payment.shopId] = {
          shop: payment.shop,
          payments: [],
          totalAmountUSDT: 0,
          totalAmountAfterCommissionUSDT: 0,
          gatewayBreakdown: {},
          oldestPaymentDate: payment.paidAt!,
        };
      }

      const data = merchantData[payment.shopId];
      data.payments.push(payment);

      // Convert to USDT
      const amountUSDT = await currencyService.convertToUSDT(payment.amount, payment.currency);
      data.totalAmountUSDT += amountUSDT;

      // Calculate commission
      let commissionRate = 10; // Default 10%
      
      if (payment.shop.gatewaySettings) {
        try {
          const gatewaySettings = JSON.parse(payment.shop.gatewaySettings);
          const gatewayDisplayName = this.getGatewayDisplayName(payment.gateway);
          
          if (gatewaySettings[gatewayDisplayName]?.commission !== undefined) {
            commissionRate = gatewaySettings[gatewayDisplayName].commission;
          }
        } catch (error) {
          console.error('Error parsing gateway settings:', error);
        }
      }

      const amountAfterCommissionUSDT = amountUSDT * (1 - commissionRate / 100);
      data.totalAmountAfterCommissionUSDT += amountAfterCommissionUSDT;

      // Gateway breakdown
      if (!data.gatewayBreakdown[payment.gateway]) {
        data.gatewayBreakdown[payment.gateway] = {
          gateway: payment.gateway,
          count: 0,
          amountUSDT: 0,
          amountAfterCommissionUSDT: 0,
          commission: commissionRate,
        };
      }

      data.gatewayBreakdown[payment.gateway].count++;
      data.gatewayBreakdown[payment.gateway].amountUSDT += amountUSDT;
      data.gatewayBreakdown[payment.gateway].amountAfterCommissionUSDT += amountAfterCommissionUSDT;

      // Track oldest payment
      if (payment.paidAt! < data.oldestPaymentDate) {
        data.oldestPaymentDate = payment.paidAt!;
      }
    }

    // Convert to array and apply filters
    let merchants = Object.values(merchantData).map(data => ({
      id: data.shop.id,
      fullName: data.shop.name,
      username: data.shop.username,
      telegramId: data.shop.telegram,
      merchantUrl: data.shop.shopUrl,
      wallets: {
        usdtPolygonWallet: data.shop.usdtPolygonWallet,
        usdtTrcWallet: data.shop.usdtTrcWallet,
        usdtErcWallet: data.shop.usdtErcWallet,
        usdcPolygonWallet: data.shop.usdcPolygonWallet,
      },
      totalAmountUSDT: Math.round(data.totalAmountUSDT * 100) / 100,
      totalAmountAfterCommissionUSDT: Math.round(data.totalAmountAfterCommissionUSDT * 100) / 100,
      paymentsCount: data.payments.length,
      oldestPaymentDate: data.oldestPaymentDate,
      gatewayBreakdown: Object.values(data.gatewayBreakdown).map(gb => ({
        gateway: gb.gateway,
        count: gb.count,
        amountUSDT: Math.round(gb.amountUSDT * 100) / 100,
        amountAfterCommissionUSDT: Math.round(gb.amountAfterCommissionUSDT * 100) / 100,
        commission: gb.commission,
      })),
    }));

    // Apply filters
    if (minAmount) {
      merchants = merchants.filter(m => m.totalAmountAfterCommissionUSDT >= minAmount);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      merchants = merchants.filter(m => 
        m.fullName.toLowerCase().includes(searchLower) ||
        m.username.toLowerCase().includes(searchLower)
      );
    }

    // Sort by total amount (descending)
    merchants.sort((a, b) => b.totalAmountAfterCommissionUSDT - a.totalAmountAfterCommissionUSDT);

    // Calculate summary
    const summary = {
      totalMerchants: merchants.length,
      totalAmountUSDT: Math.round(merchants.reduce((sum, m) => sum + m.totalAmountUSDT, 0) * 100) / 100,
      totalAmountAfterCommissionUSDT: Math.round(merchants.reduce((sum, m) => sum + m.totalAmountAfterCommissionUSDT, 0) * 100) / 100,
    };

    // Apply pagination
    const skip = (page - 1) * limit;
    const paginatedMerchants = merchants.slice(skip, skip + limit);

    return {
      merchants: paginatedMerchants,
      pagination: {
        page,
        limit,
        total: merchants.length,
        totalPages: Math.ceil(merchants.length / limit),
      },
      summary,
    };
  }

  async createPayout(payoutData: CreatePayoutRequest): Promise<PayoutResponse> {
    const { shopId, amount, network, notes } = payoutData;

    // Verify shop exists
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        id: true,
        name: true,
        username: true,
      },
    });

    if (!shop) {
      throw new Error('Shop not found');
    }

    // Create payout
    const payout = await prisma.payout.create({
      data: {
        shopId,
        amount,
        network,
        status: 'COMPLETED', // Admin-created payouts are always completed
        notes,
        paidAt: new Date(), // Set to current time
      },
    });

    return {
      id: payout.id,
      shopId: payout.shopId,
      shopName: shop.name,
      shopUsername: shop.username,
      amount: payout.amount,
      network: payout.network,
      status: payout.status,
      txid: payout.txid,
      notes: payout.notes,
      createdAt: payout.createdAt,
      paidAt: payout.paidAt,
    };
  }

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

    const where: any = {};

    if (shopId) {
      where.shopId = shopId;
    }

    if (network) {
      where.network = network;
    }

    if (dateFrom || dateTo) {
      where.paidAt = {};
      if (dateFrom) {
        where.paidAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.paidAt.lte = new Date(dateTo);
      }
    }

    if (search) {
      where.OR = [
        { shop: { name: { contains: search, mode: 'insensitive' } } },
        { shop: { username: { contains: search, mode: 'insensitive' } } },
        { notes: { contains: search, mode: 'insensitive' } },
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

    return {
      payouts: payouts.map(payout => ({
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
        paidAt: payout.paidAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPayoutById(id: string): Promise<PayoutResponse | null> {
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

    if (!payout) return null;

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
      paidAt: payout.paidAt,
    };
  }

  async deletePayout(id: string): Promise<void> {
    await prisma.payout.delete({
      where: { id },
    });
  }

  async getAllPayments(filters: any): Promise<{
    payments: any[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const { page, limit, status, gateway, shopId, dateFrom, dateTo, search } = filters;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (status) {
      where.status = status.toUpperCase();
    }

    if (gateway) {
      where.gateway = gateway.toLowerCase();
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
        { gatewayOrderId: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
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
              name: true,
              username: true,
            },
          },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      payments: payments.map(payment => ({
        id: payment.id,
        shopId: payment.shopId,
        shopName: payment.shop.name,
        shopUsername: payment.shop.username,
        gateway: payment.gateway,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        orderId: payment.orderId,
        gatewayOrderId: payment.gatewayOrderId,
        customerEmail: payment.customerEmail,
        customerName: payment.customerName,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        paidAt: payment.paidAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPaymentById(id: string): Promise<any | null> {
    const payment = await prisma.payment.findUnique({
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

    if (!payment) return null;

    return {
      id: payment.id,
      shopId: payment.shopId,
      shopName: payment.shop.name,
      shopUsername: payment.shop.username,
      gateway: payment.gateway,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      orderId: payment.orderId,
      gatewayOrderId: payment.gatewayOrderId,
      gatewayPaymentId: payment.gatewayPaymentId,
      customerEmail: payment.customerEmail,
      customerName: payment.customerName,
      externalPaymentUrl: payment.externalPaymentUrl,
      successUrl: payment.successUrl,
      failUrl: payment.failUrl,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      paidAt: payment.paidAt,
      merchantPaid: payment.merchantPaid,
      adminNotes: payment.adminNotes,
      statusChangedBy: payment.statusChangedBy,
      statusChangedAt: payment.statusChangedAt,
    };
  }

  async updatePaymentStatus(id: string, status: string, notes?: string, chargebackAmount?: number): Promise<any> {
    const updateData: any = {
      status: status.toUpperCase(),
      updatedAt: new Date(),
      statusChangedBy: 'admin',
      statusChangedAt: new Date(),
    };

    if (notes) {
      updateData.adminNotes = notes;
    }

    if (status.toUpperCase() === 'CHARGEBACK' && chargebackAmount) {
      updateData.chargebackAmount = chargebackAmount;
    }

    if (status.toUpperCase() === 'PAID') {
      updateData.paidAt = new Date();
    }

    const payment = await prisma.payment.update({
      where: { id },
      data: updateData,
      include: {
        shop: {
          select: {
            name: true,
            username: true,
          },
        },
      },
    });

    return {
      id: payment.id,
      shopId: payment.shopId,
      shopName: payment.shop.name,
      shopUsername: payment.shop.username,
      gateway: payment.gateway,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      orderId: payment.orderId,
      gatewayOrderId: payment.gatewayOrderId,
      gatewayPaymentId: payment.gatewayPaymentId,
      customerEmail: payment.customerEmail,
      customerName: payment.customerName,
      adminNotes: payment.adminNotes,
      chargebackAmount: payment.chargebackAmount,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      paidAt: payment.paidAt,
      statusChangedBy: payment.statusChangedBy,
      statusChangedAt: payment.statusChangedAt,
    };
  }

  async getAllUsers(filters: any): Promise<{
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

    const where: any = {};

    if (status) {
      where.status = status.toUpperCase();
    }

    const [users, total] = await Promise.all([
      prisma.shop.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          username: true,
          telegram: true,
          shopUrl: true,
          paymentGateways: true,
          gatewaySettings: true,
          publicKey: true,
          usdtPolygonWallet: true,
          usdtTrcWallet: true,
          usdtErcWallet: true,
          usdcPolygonWallet: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.shop.count({ where }),
    ]);

    return {
      users: users.map(user => ({
        id: user.id,
        fullName: user.name,
        username: user.username,
        telegramId: user.telegram,
        merchantUrl: user.shopUrl,
        gateways: user.paymentGateways ? JSON.parse(user.paymentGateways) : null,
        gatewaySettings: user.gatewaySettings ? JSON.parse(user.gatewaySettings) : null,
        publicKey: user.publicKey,
        wallets: {
          usdtPolygonWallet: user.usdtPolygonWallet,
          usdtTrcWallet: user.usdtTrcWallet,
          usdtErcWallet: user.usdtErcWallet,
          usdcPolygonWallet: user.usdcPolygonWallet,
        },
        status: user.status,
        createdAt: user.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserById(id: string): Promise<UserResponse | null> {
    const user = await prisma.shop.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        username: true,
        telegram: true,
        shopUrl: true,
        paymentGateways: true,
        gatewaySettings: true,
        publicKey: true,
        usdtPolygonWallet: true,
        usdtTrcWallet: true,
        usdtErcWallet: true,
        usdcPolygonWallet: true,
        status: true,
        createdAt: true,
      },
    });

    if (!user) return null;

    return {
      id: user.id,
      fullName: user.name,
      username: user.username,
      telegramId: user.telegram,
      merchantUrl: user.shopUrl,
      gateways: user.paymentGateways ? JSON.parse(user.paymentGateways) : null,
      gatewaySettings: user.gatewaySettings ? JSON.parse(user.gatewaySettings) : null,
      publicKey: user.publicKey,
      wallets: {
        usdtPolygonWallet: user.usdtPolygonWallet,
        usdtTrcWallet: user.usdtTrcWallet,
        usdtErcWallet: user.usdtErcWallet,
        usdcPolygonWallet: user.usdcPolygonWallet,
      },
      status: user.status,
      createdAt: user.createdAt,
    };
  }

  async createUser(userData: CreateUserRequest): Promise<UserResponse> {
    const {
      fullName,
      username,
      password,
      telegramId,
      merchantUrl,
      gateways,
      gatewaySettings,
      wallets
    } = userData;

    // Check if username already exists
    const existingUser = await prisma.shop.findUnique({
      where: { username },
    });

    if (existingUser) {
      throw new Error('Username already exists');
    }

    // Check if telegram already exists (if provided)
    if (telegramId) {
      const existingTelegram = await prisma.shop.findUnique({
        where: { telegram: telegramId },
      });

      if (existingTelegram) {
        throw new Error('Telegram username already exists');
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate API keys
    const publicKey = 'pk_' + crypto.randomBytes(32).toString('hex');
    const secretKey = 'sk_' + crypto.randomBytes(32).toString('hex');

    // Create user
    const newUser = await prisma.shop.create({
      data: {
        name: fullName,
        username,
        password: hashedPassword,
        telegram: telegramId,
        shopUrl: merchantUrl,
        paymentGateways: gateways ? JSON.stringify(gateways) : null,
        gatewaySettings: gatewaySettings ? JSON.stringify(gatewaySettings) : null,
        usdtPolygonWallet: wallets?.usdtPolygonWallet || null,
        usdtTrcWallet: wallets?.usdtTrcWallet || null,
        usdtErcWallet: wallets?.usdtErcWallet || null,
        usdcPolygonWallet: wallets?.usdcPolygonWallet || null,
        publicKey,
        secretKey,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        name: true,
        username: true,
        telegram: true,
        shopUrl: true,
        paymentGateways: true,
        gatewaySettings: true,
        publicKey: true,
        usdtPolygonWallet: true,
        usdtTrcWallet: true,
        usdtErcWallet: true,
        usdcPolygonWallet: true,
        status: true,
        createdAt: true,
      },
    });

    return {
      id: newUser.id,
      fullName: newUser.name,
      username: newUser.username,
      telegramId: newUser.telegram,
      merchantUrl: newUser.shopUrl,
      gateways: newUser.paymentGateways ? JSON.parse(newUser.paymentGateways) : null,
      gatewaySettings: newUser.gatewaySettings ? JSON.parse(newUser.gatewaySettings) : null,
      publicKey: newUser.publicKey,
      wallets: {
        usdtPolygonWallet: newUser.usdtPolygonWallet,
        usdtTrcWallet: newUser.usdtTrcWallet,
        usdtErcWallet: newUser.usdtErcWallet,
        usdcPolygonWallet: newUser.usdcPolygonWallet,
      },
      status: newUser.status,
      createdAt: newUser.createdAt,
    };
  }

  async updateUser(id: string, updateData: UpdateUserRequest): Promise<UserResponse> {
    const updatePayload: any = { ...updateData };

    // Hash password if provided
    if (updateData.password) {
      updatePayload.password = await bcrypt.hash(updateData.password, 12);
    }

    // Handle field name mappings
    if (updateData.fullName) {
      updatePayload.name = updateData.fullName;
      delete updatePayload.fullName;
    }

    if (updateData.telegramId) {
      updatePayload.telegram = updateData.telegramId;
      delete updatePayload.telegramId;
    }

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

    const updatedUser = await prisma.shop.update({
      where: { id },
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
        usdtPolygonWallet: true,
        usdtTrcWallet: true,
        usdtErcWallet: true,
        usdcPolygonWallet: true,
        status: true,
        createdAt: true,
      },
    });

    return {
      id: updatedUser.id,
      fullName: updatedUser.name,
      username: updatedUser.username,
      telegramId: updatedUser.telegram,
      merchantUrl: updatedUser.shopUrl,
      gateways: updatedUser.paymentGateways ? JSON.parse(updatedUser.paymentGateways) : null,
      gatewaySettings: updatedUser.gatewaySettings ? JSON.parse(updatedUser.gatewaySettings) : null,
      publicKey: updatedUser.publicKey,
      wallets: {
        usdtPolygonWallet: updatedUser.usdtPolygonWallet,
        usdtTrcWallet: updatedUser.usdtTrcWallet,
        usdtErcWallet: updatedUser.usdtErcWallet,
        usdcPolygonWallet: updatedUser.usdcPolygonWallet,
      },
      status: updatedUser.status,
      createdAt: updatedUser.createdAt,
    };
  }

  async deleteUser(id: string): Promise<void> {
    await prisma.shop.delete({
      where: { id },
    });
  }

  async suspendUser(id: string): Promise<UserResponse> {
    const updatedUser = await prisma.shop.update({
      where: { id },
      data: { status: 'SUSPENDED' },
      select: {
        id: true,
        name: true,
        username: true,
        telegram: true,
        shopUrl: true,
        paymentGateways: true,
        gatewaySettings: true,
        publicKey: true,
        usdtPolygonWallet: true,
        usdtTrcWallet: true,
        usdtErcWallet: true,
        usdcPolygonWallet: true,
        status: true,
        createdAt: true,
      },
    });

    return {
      id: updatedUser.id,
      fullName: updatedUser.name,
      username: updatedUser.username,
      telegramId: updatedUser.telegram,
      merchantUrl: updatedUser.shopUrl,
      gateways: updatedUser.paymentGateways ? JSON.parse(updatedUser.paymentGateways) : null,
      gatewaySettings: updatedUser.gatewaySettings ? JSON.parse(updatedUser.gatewaySettings) : null,
      publicKey: updatedUser.publicKey,
      wallets: {
        usdtPolygonWallet: updatedUser.usdtPolygonWallet,
        usdtTrcWallet: updatedUser.usdtTrcWallet,
        usdtErcWallet: updatedUser.usdtErcWallet,
        usdcPolygonWallet: updatedUser.usdcPolygonWallet,
      },
      status: updatedUser.status,
      createdAt: updatedUser.createdAt,
    };
  }

  async activateUser(id: string): Promise<UserResponse> {
    const updatedUser = await prisma.shop.update({
      where: { id },
      data: { status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        username: true,
        telegram: true,
        shopUrl: true,
        paymentGateways: true,
        gatewaySettings: true,
        publicKey: true,
        usdtPolygonWallet: true,
        usdtTrcWallet: true,
        usdtErcWallet: true,
        usdcPolygonWallet: true,
        status: true,
        createdAt: true,
      },
    });

    return {
      id: updatedUser.id,
      fullName: updatedUser.name,
      username: updatedUser.username,
      telegramId: updatedUser.telegram,
      merchantUrl: updatedUser.shopUrl,
      gateways: updatedUser.paymentGateways ? JSON.parse(updatedUser.paymentGateways) : null,
      gatewaySettings: updatedUser.gatewaySettings ? JSON.parse(updatedUser.gatewaySettings) : null,
      publicKey: updatedUser.publicKey,
      wallets: {
        usdtPolygonWallet: updatedUser.usdtPolygonWallet,
        usdtTrcWallet: updatedUser.usdtTrcWallet,
        usdtErcWallet: updatedUser.usdtErcWallet,
        usdcPolygonWallet: updatedUser.usdcPolygonWallet,
      },
      status: updatedUser.status,
      createdAt: updatedUser.createdAt,
    };
  }
}
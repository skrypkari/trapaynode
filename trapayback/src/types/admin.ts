export interface PayoutStats {
  totalPayout: number;      // Сумма всех оплаченных мерчанту транзакций, с вычетом комиссии, в USDT
  awaitingPayout: number;   // Сумма всех ожидающих выплат (eligible for payout), с вычетом комиссии, в USDT
  thisMonth: number;        // Сумма всех выплат в текущем месяце, с учетом комиссии, в USDT
  availableBalance: number; // Сумма всех ожидающих выплат без вычета комиссии, в USDT
}

export interface PaymentForPayout {
  id: string;
  shopId: string;
  amount: number;
  currency: string;
  status: string;
  gateway: string;
  paidAt: Date | null;
  merchantPaid: boolean;
  createdAt: Date;
  shop: {
    gatewaySettings: string | null;
  };
}

export interface MerchantAwaitingPayout {
  id: string;
  fullName: string;
  username: string;
  telegramId?: string | null;
  merchantUrl: string;
  // Wallet information
  wallets: {
    usdtPolygonWallet?: string | null;
    usdtTrcWallet?: string | null;
    usdtErcWallet?: string | null;
    usdcPolygonWallet?: string | null;
  };
  // Payout amounts
  totalAmountUSDT: number;           // Общая сумма без комиссии в USDT
  totalAmountAfterCommissionUSDT: number; // Сумма с вычетом комиссии в USDT
  // Payment details
  paymentsCount: number;             // Количество платежей ожидающих выплату
  oldestPaymentDate: Date;           // Дата самого старого платежа
  // Gateway breakdown
  gatewayBreakdown: Array<{
    gateway: string;
    count: number;
    amountUSDT: number;
    amountAfterCommissionUSDT: number;
    commission: number; // Процент комиссии
  }>;
}

export interface MerchantsAwaitingPayoutFilters {
  page: number;
  limit: number;
  minAmount?: number; // Минимальная сумма для фильтрации
  search?: string;    // Поиск по имени или username
}

// New interfaces for payout management
export interface CreatePayoutRequest {
  shopId: string;
  amount: number;
  network: string;
  notes?: string;
}

export interface PayoutResponse {
  id: string;
  shopId: string;
  shopName: string;
  shopUsername: string;
  amount: number;
  network: string;
  status: string;
  txid?: string | null;
  notes?: string | null;
  createdAt: Date;
  paidAt: Date;
}

export interface PayoutFilters {
  page: number;
  limit: number;
  shopId?: string;
  network?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

// ✅ ДОБАВЛЕНО: Новые интерфейсы для статистики мерчантов
export interface MerchantStatisticsFilters {
  shopId?: string;        // Фильтр по конкретному мерчанту
  period?: 'all' | 'year' | 'month' | 'week' | 'custom'; // Предустановленные периоды
  dateFrom?: string;      // Кастомный период - начало
  dateTo?: string;        // Кастомный период - конец
}

export interface MerchantStatistics {
  // Основные метрики
  totalTurnover: number;        // Всего оборот в USDT (сумма всех PAID платежей)
  merchantEarnings: number;     // Заработано мерчантов в USDT (оборот - комиссия шлюза)
  gatewayEarnings: number;      // Заработано шлюзом в USDT (комиссия)
  totalPaidOut: number;         // Выплачено в USDT (сумма всех выплат)
  averageCheck: number;         // Средний чек в USDT
  
  // Дополнительная информация
  totalPayments: number;        // Общее количество платежей
  successfulPayments: number;   // Количество успешных платежей
  conversionRate: number;       // Конверсия (% успешных платежей)
  
  // Разбивка по шлюзам
  gatewayBreakdown: Array<{
    gateway: string;
    gatewayDisplayName: string;
    paymentsCount: number;
    turnoverUSDT: number;
    commissionUSDT: number;
    merchantEarningsUSDT: number;
    averageCommissionRate: number; // Средняя комиссия в %
  }>;
  
  // Разбивка по мерчантам (если не выбран конкретный мерчант)
  merchantBreakdown?: Array<{
    shopId: string;
    shopName: string;
    shopUsername: string;
    paymentsCount: number;
    turnoverUSDT: number;
    commissionUSDT: number;
    merchantEarningsUSDT: number;
    paidOutUSDT: number;
    averageCheckUSDT: number;
  }>;
  
  // Временные данные для графиков
  dailyData: Array<{
    date: string;
    turnover: number;
    merchantEarnings: number;
    gatewayEarnings: number;
    paymentsCount: number;
  }>;
  
  // Период анализа
  periodInfo: {
    from: Date;
    to: Date;
    periodType: string;
    daysCount: number;
  };
}
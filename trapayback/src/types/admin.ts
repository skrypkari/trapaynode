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
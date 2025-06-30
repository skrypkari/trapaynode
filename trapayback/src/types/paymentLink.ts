export interface CreatePaymentLinkRequest {
  amount: number; // ✅ ВСЕГДА обязательный от мерчанта
  currency?: string;
  sourceCurrency?: string; // For Plisio (crypto currency)
  gateway: string; // Gateway ID (0001, 0010, 1000)
  maxPayments?: number;
  expiresAt?: string; // ISO date string
  // ✅ successUrl и failUrl опциональные - по умолчанию tesoft.uk/success и tesoft.uk/fail
  successUrl?: string;
  failUrl?: string;
  // Rapyd specific fields
  country?: string;
  language?: string;
}

export interface UpdatePaymentLinkRequest extends Partial<CreatePaymentLinkRequest> {
  status?: 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | 'COMPLETED';
}

export interface PaymentLinkResponse {
  id: string;
  shopId: string;
  amount: number; // ✅ Всегда есть
  currency: string;
  sourceCurrency?: string;
  gateway: string;
  maxPayments: number;
  currentPayments: number;
  status: string;
  expiresAt?: Date;
  successUrl?: string;
  failUrl?: string;
  // Rapyd specific fields
  country?: string;
  language?: string;
  // URLs
  linkUrl: string; // ✅ ИСПРАВЛЕНО: https://app.trapay.uk/link/{id}
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  // Shop info
  shop?: {
    name: string;
    username: string;
  };
  // Statistics
  payments?: PaymentLinkPayment[];
}

export interface PaymentLinkPayment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  customerEmail?: string;
  customerName?: string;
  createdAt: Date;
  paidAt?: Date;
}

export interface PaymentLinkFilters {
  page: number;
  limit: number;
  status?: string;
  gateway?: string;
  search?: string;
}

export interface PaymentLinkStatistics {
  totalLinks: number;
  activeLinks: number;
  totalPayments: number;
  totalRevenue: number; // In USDT
  conversionRate: number; // Percentage
}

// For public payment link page
export interface PublicPaymentLinkData {
  id: string;
  amount: number; // ✅ Всегда есть фиксированная сумма
  currency: string;
  sourceCurrency?: string;
  gateway: string;
  maxPayments: number;
  currentPayments: number;
  status: string;
  expiresAt?: Date;
  // Shop branding
  shopName: string;
  // Availability
  isAvailable: boolean;
  remainingPayments: number;
}

// ✅ УПРОЩЕНО: Только email и имя
export interface InitiatePaymentFromLinkRequest {
  linkId: string;
  customerEmail?: string; // ✅ Только email
  customerName?: string;  // ✅ Только имя
}

export interface InitiatePaymentFromLinkResponse {
  paymentId: string;
  paymentUrl: string; // ✅ ИСПРАВЛЕНО: Зависит от шлюза
  expiresAt?: Date;
}
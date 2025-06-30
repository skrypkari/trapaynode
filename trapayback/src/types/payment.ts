export interface CreatePaymentRequest {
  shopId: string;
  gateway: string;
  amount: number;
  currency?: string;
  sourceCurrency?: string; // New field for source currency
  usage?: 'ONCE' | 'REUSABLE';
  expiresAt?: Date;
  redirectUrl: string;
  customerEmail?: string;
  customerName?: string;
  // New Rapyd fields
  country?: string;
  language?: string;
  amountIsEditable?: boolean;
  maxPayments?: number;
  customer?: string; // Rapyd customer ID
}

export interface CreatePublicPaymentRequest {
  public_key: string;
  gateway: string;
  order_id?: string; // Merchant's order ID (optional)
  amount: number;
  currency?: string;
  source_currency?: string; // New field for source currency
  usage?: 'ONCE' | 'REUSABLE';
  expires_at?: string; // ISO string
  success_url?: string;
  fail_url?: string;
  customer_email?: string;
  customer_name?: string;
  // New Rapyd fields
  country?: string;
  language?: string;
  amount_is_editable?: boolean;
  max_payments?: number;
  customer?: string; // Rapyd customer ID
}

export interface UpdatePaymentRequest {
  gateway?: string;
  amount?: number;
  currency?: string;
  sourceCurrency?: string; // New field for source currency
  usage?: 'ONCE' | 'REUSABLE';
  expiresAt?: Date;
  redirectUrl?: string;
  status?: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
  externalPaymentUrl?: string;
  customerEmail?: string;
  customerName?: string;
  // New Rapyd fields
  country?: string;
  language?: string;
  amountIsEditable?: boolean;
  maxPayments?: number;
  customer?: string;
}

export interface PaymentResponse {
  id: string;
  shopId: string;
  gateway: string;
  amount: number;
  currency: string;
  sourceCurrency?: string | null; // New field
  usage: string;
  expiresAt?: Date | null;
  redirectUrl: string; // ✅ Always tesoft.uk URL for merchants
  status: string;
  externalPaymentUrl?: string | null; // Original gateway URL (for internal use)
  customerEmail?: string | null;
  customerName?: string | null;
  // New Rapyd fields
  country?: string | null;
  language?: string | null;
  amountIsEditable?: boolean | null;
  maxPayments?: number | null;
  customer?: string | null;
  // New payment details fields
  cardLast4?: string | null;
  paymentMethod?: string | null;
  bankId?: string | null;
  remitterIban?: string | null;
  remitterName?: string | null;
  createdAt: Date;
  updatedAt: Date;
  shop?: {
    name: string;
    username: string;
  };
  webhookLogs?: any[];
}

export interface PaymentStatusResponse {
  id: string;
  gateway: string;
  amount: number;
  currency: string;
  source_currency?: string | null; // New field
  status: string;
  payment_url?: string | null; // ✅ Always tesoft.uk URL
  external_payment_url?: string | null; // ✅ ДОБАВЛЕНО: Original gateway URL
  success_url: string;
  fail_url: string;
  customer_email?: string | null;
  customer_name?: string | null;
  invoice_total_sum?: number | null;
  qr_code?: string | null;
  qr_url?: string | null;
  order_id?: string | null; // Merchant's order ID
  gateway_order_id?: string | null; // Gateway order ID (8digits-8digits)
  merchant_brand?: string; // Add merchant brand field
  // New Rapyd fields
  country?: string | null;
  language?: string | null;
  amount_is_editable?: boolean | null;
  max_payments?: number | null;
  rapyd_customer?: string | null;
  // New payment details fields
  card_last4?: string | null;
  payment_method?: string | null;
  bank_id?: string | null;
  remitter_iban?: string | null;
  remitter_name?: string | null;
  created_at: Date;
  updated_at: Date;
  expires_at?: Date | null;
}

export interface PaymentFilters {
  page: number;
  limit: number;
  status?: string;
  gateway?: string;
}
import { loggerService } from '../loggerService';

export interface PlisioPaymentRequest {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  productName: string;
  description: string;
  successUrl: string;
  failUrl: string;
  customerEmail?: string;
  customerName?: string;
  isSourceCurrency?: boolean;
  sourceCurrency?: string;
}

export interface PlisioPaymentResponse {
  gateway_payment_id: string;
  payment_url: string;
  invoice_total_sum?: number;
  qr_code?: string;
  qr_url?: string;
}

export interface PlisioApiResponse {
  status: string;
  data?: {
    txn_id?: string;
    invoice_url?: string;
    invoice_total_sum?: number;
    qr_code?: string;
    qr_url?: string;
  };
  error?: string;
  message?: string;
}

export class PlisioService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    // ✅ ИСПРАВЛЕНО: Используем прямой API Plisio
    this.apiUrl = 'https://api.plisio.net/api/v1/invoices/new';
    this.apiKey = process.env.PLISIO_API_KEY || '';
    
    if (!this.apiKey) {
      console.warn('⚠️ PLISIO_API_KEY not found in environment variables');
    } else {
      console.log('💰 Plisio service initialized with direct API');
    }
  }

  async createPayment(paymentData: PlisioPaymentRequest): Promise<PlisioPaymentResponse> {
    const {
      orderId,
      amount,
      currency,
      productName,
      description,
      successUrl,
      failUrl,
      customerEmail,
      customerName,
      isSourceCurrency,
      sourceCurrency,
    } = paymentData;

    if (!this.apiKey) {
      throw new Error('Plisio API key is not configured');
    }

    // ✅ ИСПРАВЛЕНО: Подготавливаем параметры для прямого API Plisio
    const params = new URLSearchParams({
      api_key: this.apiKey,
      order_number: orderId,
      order_name: productName,
      description: description,
      success_url: successUrl,
      fail_url: failUrl,
      callback_url: 'https://api.trapay.uk/api/webhooks/gateway/plisio',
    });

    // ✅ ДОБАВЛЕНО: Логика для source_currency и currency
    if (sourceCurrency) {
      // Если указан sourceCurrency, то это криптовалюта для оплаты
      params.append('currency', sourceCurrency); // Криптовалюта для оплаты
      params.append('source_currency', currency); // Фиатная валюта магазина
      params.append('source_amount', amount.toString()); // Сумма в фиатной валюте
    } else {
      // Если sourceCurrency не указан, используем обычную логику
      params.append('currency', currency);
      params.append('amount', amount.toString());
    }

    // Добавляем опциональные параметры
    if (customerEmail) {
      params.append('email', customerEmail);
    }

    if (customerName) {
      params.append('name', customerName);
    }

    // ✅ ИСПРАВЛЕНО: Формируем полный URL с параметрами
    const fullUrl = `${this.apiUrl}?${params.toString()}`;

    const startTime = Date.now();

    try {
      console.log('=== PLISIO DIRECT API REQUEST ===');
      console.log('URL:', this.apiUrl);
      console.log('Parameters:', Object.fromEntries(params.entries()));
      console.log('Full URL (without API key):', fullUrl.replace(this.apiKey, 'HIDDEN'));

      // Log request
      loggerService.logWhiteDomainRequest('plisio_direct', '/invoices/new', 'GET', Object.fromEntries(params.entries()));

      // ✅ ИСПРАВЛЕНО: Используем GET запрос как в документации
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TesSoft Payment System/1.0',
        },
      });

      const responseTime = Date.now() - startTime;

      console.log('=== PLISIO DIRECT API RESPONSE ===');
      console.log('Status:', response.status);
      console.log('Status Text:', response.statusText);
      console.log('Response Time:', responseTime + 'ms');

      const responseText = await response.text();
      console.log('Raw Response Body:', responseText);

      if (!response.ok) {
        console.error('=== PLISIO API ERROR ===');
        console.error('HTTP Status:', response.status);
        console.error('Response Body:', responseText);
        
        loggerService.logWhiteDomainResponse('plisio_direct', '/invoices/new', response.status, responseText, responseTime);
        loggerService.logWhiteDomainError('plisio_direct', '/invoices/new', `HTTP ${response.status}: ${responseText}`);
        
        throw new Error(`HTTP error! status: ${response.status}, body: ${responseText}`);
      }

      let result: PlisioApiResponse;
      try {
        result = JSON.parse(responseText) as PlisioApiResponse;
      } catch (parseError) {
        console.error('Failed to parse JSON response:', parseError);
        
        loggerService.logWhiteDomainError('plisio_direct', '/invoices/new', `JSON Parse Error: ${parseError}`);
        
        throw new Error(`Invalid JSON response from Plisio API: ${responseText}`);
      }

      console.log('=== PARSED PLISIO RESPONSE ===');
      console.log('Parsed Result:', JSON.stringify(result, null, 2));

      loggerService.logWhiteDomainResponse('plisio_direct', '/invoices/new', response.status, result, responseTime);

      if (result.status !== 'success') {
        const errorMessage = result.message || result.error || 'Unknown error from Plisio API';
        console.error('=== PLISIO API BUSINESS ERROR ===');
        console.error('Error Message:', errorMessage);
        
        loggerService.logWhiteDomainError('plisio_direct', '/invoices/new', `Business Error: ${errorMessage}`);
        
        throw new Error(`Plisio API error: ${errorMessage}`);
      }

      if (!result.data?.txn_id || !result.data?.invoice_url) {
        console.error('=== PLISIO API INCOMPLETE RESPONSE ===');
        console.error('Missing txn_id or invoice_url in response');
        console.error('Response data:', result.data);
        
        loggerService.logWhiteDomainError('plisio_direct', '/invoices/new', 'Incomplete response: missing txn_id or invoice_url');
        
        throw new Error('Invalid response from Plisio API: missing txn_id or invoice_url');
      }

      console.log('=== PLISIO SUCCESS ===');
      console.log('Transaction ID:', result.data.txn_id);
      console.log('Invoice URL:', result.data.invoice_url);
      console.log('Amount:', amount, currency);
      if (sourceCurrency) {
        console.log('Source Currency:', sourceCurrency, '(crypto for payment)');
        console.log('Target Currency:', currency, '(fiat for merchant)');
      }

      return {
        gateway_payment_id: result.data.txn_id,
        payment_url: result.data.invoice_url,
        invoice_total_sum: result.data.invoice_total_sum,
        qr_code: result.data.qr_code,
        qr_url: result.data.qr_url,
      };

    } catch (error) {
      console.error('=== PLISIO SERVICE ERROR ===');
      console.error('Error details:', error);
      
      loggerService.logWhiteDomainError('plisio_direct', '/invoices/new', error);
      
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        throw new Error(`Failed to create Plisio payment: ${error.message}`);
      }
      
      throw new Error('Failed to create Plisio payment: Unknown error');
    }
  }

  async verifyPayment(gatewayPaymentId: string): Promise<{
    status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
    amount?: number;
    currency?: string;
  }> {
    const startTime = Date.now();

    try {
      if (!this.apiKey) {
        throw new Error('Plisio API key is not configured');
      }

      const params = new URLSearchParams({
        api_key: this.apiKey,
        txn_id: gatewayPaymentId,
      });

      const verifyUrl = `https://api.plisio.net/api/v1/operations/${gatewayPaymentId}?${params.toString()}`;

      loggerService.logWhiteDomainRequest('plisio_direct', `/operations/${gatewayPaymentId}`, 'GET', Object.fromEntries(params.entries()));

      const response = await fetch(verifyUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TesSoft Payment System/1.0',
        },
      });

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        const responseText = await response.text();
        loggerService.logWhiteDomainResponse('plisio_direct', `/operations/${gatewayPaymentId}`, response.status, responseText, responseTime);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json() as PlisioApiResponse;
      
      loggerService.logWhiteDomainResponse('plisio_direct', `/operations/${gatewayPaymentId}`, response.status, result, responseTime);

      if (result.status !== 'success') {
        loggerService.logWhiteDomainError('plisio_direct', `/operations/${gatewayPaymentId}`, `Plisio API error: ${result.message || result.error || 'Unknown error'}`);
        throw new Error(`Plisio API error: ${result.message || result.error || 'Unknown error'}`);
      }

      let status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED' = 'PENDING';
      
      return {
        status,
      };

    } catch (error) {
      console.error('Plisio payment verification error:', error);
      loggerService.logWhiteDomainError('plisio_direct', `/operations/${gatewayPaymentId}`, error);
      throw new Error(`Failed to verify Plisio payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async processWebhook(webhookData: any): Promise<{
    paymentId: string;
    status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
    amount?: number;
    currency?: string;
  }> {
    console.log('Processing Plisio webhook:', webhookData);
    
    let status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED' = 'PENDING';
    
    switch (webhookData.status?.toLowerCase()) {
      case 'completed':
      case 'mismatch':
        status = 'PAID';
        break;
      case 'expired':
        status = 'EXPIRED';
        break;
      case 'error':
      case 'cancelled':
        status = 'FAILED';
        break;
      case 'new':
      case 'pending':
      default:
        status = 'PENDING';
        break;
    }
    
    return {
      paymentId: webhookData.order_number || '',
      status,
      amount: webhookData.amount,
      currency: webhookData.currency,
    };
  }
}
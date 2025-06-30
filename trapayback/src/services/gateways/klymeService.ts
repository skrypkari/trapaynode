import { loggerService } from '../loggerService';

export interface KlymePaymentLinkRequest {
  paymentId: string;
  orderId: string; // 8digits-8digits format
  amount: number;
  currency: string;
  region: 'EU' | 'GB' | 'DE'; // Регион KLYME
  redirectUrl?: string; // Будет использован BASE_URL/payment/pending
}

export interface KlymePaymentLinkResponse {
  gateway_payment_id: string;
  payment_url: string;
}

export interface KlymeApiResponse {
  uuid?: string; // ✅ ОБНОВЛЕНО: Новый формат ответа
  redirect_url?: string; // ✅ ОБНОВЛЕНО: Новый формат ответа
  // Legacy fields (for backward compatibility)
  authUrl?: string;
  // Error response
  error?: string;
  message?: string;
  statusCode?: number;
}

export class KlymeService {
  private apiUrl: string; // ✅ ОБНОВЛЕНО: Один URL для всех регионов

  constructor() {
    // ✅ ОБНОВЛЕНО: Единый маршрут для всех KLYME регионов
    this.apiUrl = 'https://tesoft.uk/gateway/klyme/';
    
    console.log('💳 KLYME service initialized with unified white domain proxy for all regions');
  }

  // ✅ Валидация валют для KLYME регионов
  private validateCurrencyForRegion(currency: string, region: 'EU' | 'GB' | 'DE'): void {
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
        // ✅ ИСПРАВЛЕНО: DE тоже поддерживает EUR
        if (upperCurrency !== 'EUR') {
          throw new Error(`KLYME DE accepts only EUR currency, got: ${upperCurrency}`);
        }
        break;
      default:
        throw new Error(`Unsupported KLYME region: ${region}`);
    }
  }

  // Helper method to generate unique reference ID in format 8digits-8digits
  private async generateUniqueReference(): Promise<string> {
    const prisma = (await import('../../config/database')).default;
    
    let reference: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      const generateSegment = () => {
        return Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
      };
      
      reference = `${generateSegment()}-${generateSegment()}`;
      
      // Check if this reference already exists in database
      const existingPayment = await prisma.payment.findFirst({
        where: { gatewayOrderId: reference },
      });

      if (!existingPayment) {
        break; // Unique reference found
      }

      attempts++;
      console.log(`⚠️ KLYME reference ${reference} already exists, generating new one (attempt ${attempts})`);
      
    } while (attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      throw new Error('Failed to generate unique KLYME reference after maximum attempts');
    }

    return reference;
  }

  async createPaymentLink(paymentData: KlymePaymentLinkRequest): Promise<KlymePaymentLinkResponse> {
    const {
      orderId,
      amount,
      currency,
      region,
    } = paymentData;

    // ✅ ИСПРАВЛЕНО: Поддерживаем все регионы EU, GB и DE
    if (region !== 'EU' && region !== 'GB' && region !== 'DE') {
      throw new Error(`KLYME payment creation is supported for EU, GB and DE regions, got: ${region}`);
    }

    // ✅ Валидация валюты для региона
    this.validateCurrencyForRegion(currency, region);

    // Convert currency to uppercase
    const upperCurrency = currency.toUpperCase();

    console.log(`💳 KLYME ${region} currency validation passed: ${upperCurrency}`);

    // Generate unique reference in 8digits-8digits format
    const reference = await this.generateUniqueReference();
    console.log(`🎯 Generated unique KLYME reference: ${reference} (8digits-8digits format for ${region})`);

    // ✅ ОБНОВЛЕНО: Используем tesoft.uk/gateway/pending.php?id=orderId
    const redirectUrl = `https://tesoft.uk/gateway/pending.php?id=${orderId}`;

    // ✅ ОБНОВЛЕНО: Prepare request body with geo parameter
    const requestBody = {
      amount: amount,
      currency: upperCurrency,
      redirectUrl: redirectUrl,
      reference: reference,
      geo: region, // ✅ ДОБАВЛЕНО: Указываем географию
    };

    const startTime = Date.now();

    try {
      console.log(`=== KLYME ${region} API REQUEST (Unified Route with Geo) ===`);
      console.log('URL:', this.apiUrl);
      console.log('Request Body:', JSON.stringify(requestBody, null, 2));
      console.log('Region (geo):', region);
      console.log('Currency:', upperCurrency, `(validated for ${region})`);
      console.log('Reference:', reference, '(8digits-8digits format)');
      console.log('Redirect URL:', redirectUrl);

      // Log request to white domain
      loggerService.logWhiteDomainRequest(`klyme_${region.toLowerCase()}`, '/create', 'POST', requestBody);

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'TesSoft Payment System/1.0',
        },
        body: JSON.stringify(requestBody),
      });

      const responseTime = Date.now() - startTime;

      console.log(`=== KLYME ${region} API RESPONSE (Unified Route) ===`);
      console.log('Status:', response.status);
      console.log('Status Text:', response.statusText);
      console.log('Headers:', Object.fromEntries(response.headers.entries()));
      console.log('Response Time:', responseTime + 'ms');

      const responseText = await response.text();
      console.log('Raw Response Body:', responseText);

      if (!response.ok) {
        console.error(`=== KLYME ${region} API ERROR ===`);
        console.error('HTTP Status:', response.status);
        console.error('Response Body:', responseText);
        
        // Log error response
        loggerService.logWhiteDomainResponse(`klyme_${region.toLowerCase()}`, '/create', response.status, responseText, responseTime);
        loggerService.logWhiteDomainError(`klyme_${region.toLowerCase()}`, '/create', `HTTP ${response.status}: ${responseText}`);
        
        throw new Error(`HTTP error! status: ${response.status}, body: ${responseText}`);
      }

      let result: KlymeApiResponse;
      try {
        result = JSON.parse(responseText) as KlymeApiResponse;
      } catch (parseError) {
        console.error('Failed to parse JSON response:', parseError);
        
        // Log parse error
        loggerService.logWhiteDomainError(`klyme_${region.toLowerCase()}`, '/create', `JSON Parse Error: ${parseError}`);
        
        throw new Error(`Invalid JSON response from KLYME ${region} API: ${responseText}`);
      }

      console.log(`=== PARSED KLYME ${region} RESPONSE ===`);
      console.log('Parsed Result:', JSON.stringify(result, null, 2));

      // Log successful response
      loggerService.logWhiteDomainResponse(`klyme_${region.toLowerCase()}`, '/create', response.status, result, responseTime);

      // Check for error in response
      if (result.error || result.statusCode) {
        const errorMessage = result.message || result.error || `Unknown error from KLYME ${region} API`;
        console.error(`=== KLYME ${region} API BUSINESS ERROR ===`);
        console.error('Error Message:', errorMessage);
        console.error('Status Code:', result.statusCode);
        
        // Log business error
        loggerService.logWhiteDomainError(`klyme_${region.toLowerCase()}`, '/create', `Business Error: ${errorMessage}`);
        
        throw new Error(`KLYME ${region} API error: ${errorMessage}`);
      }

      // ✅ ОБНОВЛЕНО: Handle new response format
      let gatewayPaymentId: string;
      let paymentUrl: string;

      if (result.uuid && result.redirect_url) {
        // ✅ Новый формат ответа
        gatewayPaymentId = result.uuid;
        paymentUrl = result.redirect_url;
        
        console.log(`=== KLYME ${region} SUCCESS (New Format) ===`);
        console.log('UUID:', result.uuid);
        console.log('Redirect URL:', result.redirect_url);
      } else if (result.authUrl) {
        // Legacy format (backward compatibility)
        gatewayPaymentId = reference; // Use reference as ID for legacy format
        paymentUrl = result.authUrl;
        
        console.log(`=== KLYME ${region} SUCCESS (Legacy Format) ===`);
        console.log('Auth URL:', result.authUrl);
        console.log('Reference Used as ID:', reference);
      } else {
        console.error(`=== KLYME ${region} API INCOMPLETE RESPONSE ===`);
        console.error('Missing uuid/redirect_url or authUrl in response');
        console.error('Response data:', result);
        
        // Log incomplete response error
        loggerService.logWhiteDomainError(`klyme_${region.toLowerCase()}`, '/create', 'Incomplete response: missing uuid/redirect_url or authUrl');
        
        throw new Error(`Invalid response from KLYME ${region} API: missing payment data`);
      }

      console.log('Currency Used:', upperCurrency, `(${region} validated)`);
      console.log('Reference Used:', reference, '(8digits-8digits format)');
      console.log('Geo Parameter:', region);

      return {
        gateway_payment_id: gatewayPaymentId,
        payment_url: paymentUrl,
      };

    } catch (error) {
      console.error(`=== KLYME ${region} SERVICE ERROR ===`);
      console.error('Error details:', error);
      
      // Log service error
      loggerService.logWhiteDomainError(`klyme_${region.toLowerCase()}`, '/create', error);
      
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        throw new Error(`Failed to create KLYME ${region} payment link: ${error.message}`);
      }
      
      throw new Error(`Failed to create KLYME ${region} payment link: Unknown error`);
    }
  }

  async verifyPayment(gatewayPaymentId: string, region: 'EU' | 'GB' | 'DE'): Promise<{
    status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
    amount?: number;
    currency?: string;
  }> {
    const startTime = Date.now();

    try {
      // ✅ ОБНОВЛЕНО: Используем единый URL с geo параметром
      const requestBody = {
        gatewayPaymentId: gatewayPaymentId,
        geo: region, // ✅ ДОБАВЛЕНО: Указываем географию для проверки
      };

      // Log request
      loggerService.logWhiteDomainRequest(`klyme_${region.toLowerCase()}`, `/verify/${gatewayPaymentId}`, 'POST', requestBody);

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TesSoft Payment System/1.0',
        },
        body: JSON.stringify(requestBody),
      });

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        const responseText = await response.text();
        loggerService.logWhiteDomainResponse(`klyme_${region.toLowerCase()}`, `/verify/${gatewayPaymentId}`, response.status, responseText, responseTime);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json() as KlymeApiResponse;
      
      // Log successful response
      loggerService.logWhiteDomainResponse(`klyme_${region.toLowerCase()}`, `/verify/${gatewayPaymentId}`, response.status, result, responseTime);

      // Check for error in response
      if (result.error || result.statusCode) {
        loggerService.logWhiteDomainError(`klyme_${region.toLowerCase()}`, `/verify/${gatewayPaymentId}`, `KLYME ${region} API error: ${result.message || result.error || 'Unknown error'}`);
        throw new Error(`KLYME ${region} API error: ${result.message || result.error || 'Unknown error'}`);
      }

      // Map KLYME status to our status
      let status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED' = 'PENDING';
      
      // Since we don't have status in verify response, return PENDING by default
      return {
        status,
      };

    } catch (error) {
      console.error(`KLYME ${region} payment verification error:`, error);
      loggerService.logWhiteDomainError(`klyme_${region.toLowerCase()}`, `/verify/${gatewayPaymentId}`, error);
      throw new Error(`Failed to verify KLYME ${region} payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Method for processing webhook from KLYME
  async processWebhook(webhookData: any): Promise<{
    paymentId: string;
    status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
    amount?: number;
    currency?: string;
    region?: string;
    additionalInfo?: {
      payment_method?: string;
      transaction_id?: string;
    };
  }> {
    console.log('Processing KLYME webhook:', webhookData);
    
    // Map KLYME webhook status to our status
    let status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED' = 'PENDING';
    
    switch (webhookData.status?.toLowerCase()) {
      case 'paid':
      case 'completed':
      case 'confirmed':
      case 'success':
      case 'successful':
        status = 'PAID';
        break;
      case 'cancelled':
      case 'canceled':
      case 'failed':
      case 'error':
      case 'rejected':
        status = 'FAILED';
        break;
      case 'expired':
      case 'timeout':
        status = 'EXPIRED';
        break;
      case 'pending':
      case 'created':
      case 'active':
      case 'processing':
      case 'in_progress':
      default:
        status = 'PENDING';
        break;
    }
    
    return {
      paymentId: webhookData.reference || webhookData.order_id || webhookData.payment_id,
      status,
      amount: webhookData.amount,
      currency: webhookData.currency,
      region: webhookData.region,
      additionalInfo: {
        payment_method: webhookData.payment_method,
        transaction_id: webhookData.transaction_id,
      },
    };
  }
}
import { loggerService } from '../loggerService';

export interface RapydPaymentLinkRequest {
  paymentId: string;
  orderId: string;
  orderName?: string;
  amount: number;
  currency: string;
  country: string;
  language?: string; 
  amountIsEditable?: boolean; 
  customer?: string;
  usage: 'ONCE' | 'REUSABLE';
  maxPayments?: number;
  successUrl: string;
  failUrl: string;
}

export interface RapydPaymentLinkResponse {
  gateway_payment_id: string;
  payment_url: string;
}

export interface RapydApiResponse {
  status: {
    error_code: string;
    status: string;
    message?: string;
    response_code?: string;
    operation_id?: string;
  };
  data?: {
    id?: string;
    redirect_url?: string;
    amount?: number;
    currency?: string;
    status?: string;
    [key: string]: any;
  };
}

export class RapydService {
  private apiUrl: string;

  constructor() {
    // Use white domain proxy server
    this.apiUrl = 'https://tesoft.uk/gateway/rapyd/';
    
    console.log('🌐 Rapyd service initialized with white domain proxy');
  }

  async createPaymentLink(paymentData: RapydPaymentLinkRequest): Promise<RapydPaymentLinkResponse> {
    const {
      orderId,
      orderName,
      amount,
      currency,
      usage,
      maxPayments,
      successUrl,
      failUrl,
    } = paymentData;

    // Convert currency to uppercase
    const upperCurrency = currency.toUpperCase();

    // ✅ ИСПРАВЛЕНО: Всегда используем GB для Rapyd
    const rapydCountry = 'GB'; // Всегда Британия
    console.log(`🇬🇧 Using GB (Britain) as country for Rapyd payment link`);

    // Use tesoft.uk URLs with payment ID
    const finalSuccessUrl = `https://tesoft.uk/gateway/success.php?id=${orderId}`;
    const finalFailUrl = `https://tesoft.uk/gateway/fail.php?id=${orderId}`;

    // ✅ ОБНОВЛЕНО: Prepare request body according to new format
    const requestBody: any = {
      amount: amount,
      currency: upperCurrency,
      cancel_checkout_url: finalFailUrl,
      complete_checkout_url: finalSuccessUrl,
      complete_payment_url: finalSuccessUrl,
      merchant_reference_id: orderId,
      description: `ORDER: ${orderId}`,
      country: 'GB',
      payment_method_types_include: ['gb_visa_card', 'gb_mastercard_card'],
      custom_elements: {
        display_description: true,
      },
    };

    const startTime = Date.now();

    try {
      console.log('=== RAPYD API REQUEST (White Domain - Updated Format) ===');
      console.log('URL:', this.apiUrl);
      console.log('Request Body (Updated Format):', JSON.stringify(requestBody, null, 2));
      console.log(`🇬🇧 Country: ${rapydCountry} (always GB for Rapyd)`);
      console.log('💳 Payment Methods: gb_visa_card, gb_mastercard_card');

      // Log request to white domain
      loggerService.logWhiteDomainRequest('rapyd', '/v1/hosted/payment_links', 'POST', requestBody);

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TesSoft Payment System/1.0',
        },
        body: JSON.stringify(requestBody),
      });

      const responseTime = Date.now() - startTime;

      console.log('=== RAPYD API RESPONSE (White Domain) ===');
      console.log('Status:', response.status);
      console.log('Status Text:', response.statusText);
      console.log('Headers:', Object.fromEntries(response.headers.entries()));
      console.log('Response Time:', responseTime + 'ms');

      const responseText = await response.text();
      console.log('Raw Response Body:', responseText);

      if (!response.ok) {
        console.error('=== RAPYD API ERROR ===');
        console.error('HTTP Status:', response.status);
        console.error('Response Body:', responseText);
        
        // Log error response
        loggerService.logWhiteDomainResponse('rapyd', '/v1/hosted/payment_links', response.status, responseText, responseTime);
        loggerService.logWhiteDomainError('rapyd', '/v1/hosted/payment_links', `HTTP ${response.status}: ${responseText}`);
        
        throw new Error(`HTTP error! status: ${response.status}, body: ${responseText}`);
      }

      let result: RapydApiResponse;
      try {
        result = JSON.parse(responseText) as RapydApiResponse;
      } catch (parseError) {
        console.error('Failed to parse JSON response:', parseError);
        
        // Log parse error
        loggerService.logWhiteDomainError('rapyd', '/v1/hosted/payment_links', `JSON Parse Error: ${parseError}`);
        
        throw new Error(`Invalid JSON response from Rapyd API: ${responseText}`);
      }

      console.log('=== PARSED RAPYD RESPONSE ===');
      console.log('Parsed Result:', JSON.stringify(result, null, 2));

      // Log successful response
      loggerService.logWhiteDomainResponse('rapyd', '/v1/hosted/payment_links', response.status, result, responseTime);

      if (result.status?.status !== 'SUCCESS') {
        const errorMessage = result.status?.message || 'Unknown error from Rapyd API';
        const errorCode = result.status?.error_code || 'UNKNOWN';
        console.error('=== RAPYD API BUSINESS ERROR ===');
        console.error('Error Code:', errorCode);
        console.error('Error Message:', errorMessage);
        console.error('Full Error Data:', result.status);
        
        // Log business error
        loggerService.logWhiteDomainError('rapyd', '/v1/hosted/payment_links', `Business Error (${errorCode}): ${errorMessage}`);
        
        throw new Error(`Rapyd API error (${errorCode}): ${errorMessage}`);
      }

      if (!result.data?.id || !result.data?.redirect_url) {
        console.error('=== RAPYD API INCOMPLETE RESPONSE ===');
        console.error('Missing id or redirect_url in response');
        console.error('Response data:', result.data);
        
        // Log incomplete response error
        loggerService.logWhiteDomainError('rapyd', '/v1/hosted/payment_links', 'Incomplete response: missing id or redirect_url');
        
        throw new Error('Invalid response from Rapyd API: missing id or redirect_url');
      }

      console.log('=== RAPYD SUCCESS ===');
      console.log('Payment Link ID:', result.data.id);
      console.log('Redirect URL:', result.data.redirect_url);
      console.log(`🇬🇧 Country used: ${rapydCountry} (GB - Britain)`);
      console.log('💳 Payment Methods: gb_visa_card, gb_mastercard_card');

      return {
        gateway_payment_id: result.data.id,
        payment_url: result.data.redirect_url,
      };

    } catch (error) {
      console.error('=== RAPYD SERVICE ERROR ===');
      console.error('Error details:', error);
      
      // Log service error
      loggerService.logWhiteDomainError('rapyd', '/v1/hosted/payment_links', error);
      
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        throw new Error(`Failed to create Rapyd payment link: ${error.message}`);
      }
      
      throw new Error('Failed to create Rapyd payment link: Unknown error');
    }
  }

  async verifyPayment(gatewayPaymentId: string): Promise<{
    status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
    amount?: number;
    currency?: string;
  }> {
    const startTime = Date.now();

    try {
      // Log request
      loggerService.logWhiteDomainRequest('rapyd', `/v1/hosted/payment_links/${gatewayPaymentId}`, 'GET', {});

      // For GET requests, we might need to use query parameters or a different approach
      const response = await fetch(`${this.apiUrl}/${gatewayPaymentId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TesSoft Payment System/1.0',
        },
      });

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        const responseText = await response.text();
        loggerService.logWhiteDomainResponse('rapyd', `/v1/hosted/payment_links/${gatewayPaymentId}`, response.status, responseText, responseTime);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json() as RapydApiResponse;
      
      // Log successful response
      loggerService.logWhiteDomainResponse('rapyd', `/v1/hosted/payment_links/${gatewayPaymentId}`, response.status, result, responseTime);

      if (result.status?.status !== 'SUCCESS') {
        loggerService.logWhiteDomainError('rapyd', `/v1/hosted/payment_links/${gatewayPaymentId}`, `Rapyd API error: ${result.status?.message || 'Unknown error'}`);
        throw new Error(`Rapyd API error: ${result.status?.message || 'Unknown error'}`);
      }

      // Map Rapyd status to our status based on webhook examples
      let status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED' = 'PENDING';
      
      if (result.data?.status) {
        switch (result.data.status.toUpperCase()) {
          case 'CLO': // Closed - completed
            status = 'PAID';
            break;
          case 'CAN': // Cancelled
            status = 'FAILED';
            break;
          case 'EXP': // Expired
            status = 'EXPIRED';
            break;
          case 'ERR': // Error
            status = 'FAILED';
            break;
          case 'NEW':
          case 'ACT': // Active
          default:
            status = 'PENDING';
            break;
        }
      }

      return {
        status,
        amount: result.data?.amount,
        currency: result.data?.currency,
      };

    } catch (error) {
      console.error('Rapyd payment verification error:', error);
      loggerService.logWhiteDomainError('rapyd', `/v1/hosted/payment_links/${gatewayPaymentId}`, error);
      throw new Error(`Failed to verify Rapyd payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Method for processing webhook from Rapyd with updated status mapping
  async processWebhook(webhookData: any): Promise<{
    paymentId: string;
    status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
    amount?: number;
    currency?: string;
  }> {
    console.log('Processing Rapyd webhook:', webhookData);
    
    // Map Rapyd webhook status to our status based on examples
    let status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED' = 'PENDING';
    
    // First check event type
    switch (webhookData.type?.toUpperCase()) {
      case 'PAYMENT_COMPLETED':
        // Check if payment is actually paid
        if (webhookData.data?.paid === true && webhookData.data?.status === 'CLO') {
          status = 'PAID';
        } else {
          status = 'PENDING';
        }
        break;
      
      case 'PAYMENT_CANCELED':
        status = 'FAILED';
        break;
      
      case 'PAYMENT_EXPIRED':
        status = 'EXPIRED';
        break;
      
      case 'PAYMENT_FAILED':
        status = 'FAILED';
        break;
      
      default:
        // For other events, check the data.status field
        switch (webhookData.data?.status?.toUpperCase()) {
          case 'CLO': // Closed - completed
            if (webhookData.data?.paid === true) {
              status = 'PAID';
            } else {
              status = 'FAILED';
            }
            break;
          case 'CAN': // Cancelled
            status = 'FAILED';
            break;
          case 'EXP': // Expired
            status = 'EXPIRED';
            break;
          case 'ERR': // Error
            status = 'FAILED';
            break;
          case 'NEW':
          case 'ACT': // Active
          default:
            status = 'PENDING';
            break;
        }
        break;
    }
    
    return {
      paymentId: webhookData.data?.merchant_reference_id || '',
      status,
      amount: webhookData.data?.amount,
      currency: webhookData.data?.currency,
    };
  }
}
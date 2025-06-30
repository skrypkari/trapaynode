import { loggerService } from '../loggerService';

export interface NodaPaymentLinkRequest {
  paymentId: string;
  orderId: string;
  name: string;
  paymentDescription: string;
  amount: number;
  currency: string;
  webhookUrl?: string;
  returnUrl?: string;
  expiryDate?: string; // ISO date string
}

export interface NodaPaymentLinkResponse {
  gateway_payment_id: string;
  payment_url: string;
  qr_code_url?: string;
  expiry_date?: string;
}

export interface NodaApiResponse {
  id?: string;
  name?: string;
  paymentDescription?: string;
  amount?: number;
  currency?: string;
  isActive?: boolean;
  createdDate?: string;
  shortLinkUrls?: {
    shortLink?: string;
    qrCodeLink?: string;
  };
  expiryDate?: string;
  // Error response
  error?: string;
  message?: string;
  statusCode?: number;
}

// Interface for Noda webhook data based on the provided example
export interface NodaWebhookData {
  PaymentId: string;
  Status: string;
  Signature: string;
  MerchantPaymentId: string;
  Reference: string;
  Amount: number;
  Currency: string;
  CardId?: string | null;
  Remitter: {
    Name: string;
    Iban: string;
    SortCode?: string | null;
    AccountNumber?: string | null;
  };
  AdditionalData?: any | null;
  DetailedInfo?: any | null;
  Method: string;
  BankId: string;
  IsSenderBank: boolean;
  BankTransactionId: string;
  Settled: string; // "Yes" or "No"
  SettlementDate: string; // ISO date string
}

export class NodaService {
  private apiUrl: string;

  constructor() {
    // ИСПРАВЛЕНО: Правильный URL без .php
    this.apiUrl = 'https://tesoft.uk/gateway/noda/';
    
    console.log('🌐 Noda service initialized with white domain proxy');
  }

  async createPaymentLink(paymentData: NodaPaymentLinkRequest): Promise<NodaPaymentLinkResponse> {
    const {
      orderId,
      name,
      paymentDescription,
      amount,
      currency,
      webhookUrl,
      returnUrl,
      expiryDate,
    } = paymentData;

    // Convert currency to uppercase
    const upperCurrency = currency.toUpperCase();

    // Use tesoft.uk URLs
    const finalWebhookUrl = `https://tesoft.uk/gateway/noda/webhook/`;
    const finalReturnUrl = `https://tesoft.uk/gateway/success.php?id=${orderId}`;

    // Prepare request body for Noda Payment Link - ПРЯМОЙ JSON БЕЗ ОБЕРТКИ
    const requestBody: any = {
      name: name,
      paymentDescription: paymentDescription,
      amount: amount,
      currency: upperCurrency,
      paymentId: orderId, // Use our order ID as Noda's paymentId (will be returned as MerchantPaymentId in webhook)
      webhookUrl: finalWebhookUrl,
      returnUrl: finalReturnUrl,
    };

    if (expiryDate) {
      requestBody.expiryDate = expiryDate;
    }

    const startTime = Date.now();

    try {
      console.log('=== NODA API REQUEST (White Domain - Direct JSON) ===');
      console.log('URL:', this.apiUrl);
      console.log('Request Body (Direct JSON):', JSON.stringify(requestBody, null, 2));
      console.log('Order ID Format:', orderId, '(8digits-8digits format for Noda)');

      // Log request to white domain
      loggerService.logWhiteDomainRequest('noda', '/payment-links', 'POST', requestBody);

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'TesSoft Payment System/1.0',
        },
        body: JSON.stringify(requestBody), // ✅ ПРЯМОЙ JSON - БЕЗ ОБЕРТКИ
      });

      const responseTime = Date.now() - startTime;

      console.log('=== NODA API RESPONSE (White Domain) ===');
      console.log('Status:', response.status);
      console.log('Status Text:', response.statusText);
      console.log('Headers:', Object.fromEntries(response.headers.entries()));
      console.log('Response Time:', responseTime + 'ms');

      const responseText = await response.text();
      console.log('Raw Response Body:', responseText);

      if (!response.ok) {
        console.error('=== NODA API ERROR ===');
        console.error('HTTP Status:', response.status);
        console.error('Response Body:', responseText);
        
        // Log error response
        loggerService.logWhiteDomainResponse('noda', '/payment-links', response.status, responseText, responseTime);
        loggerService.logWhiteDomainError('noda', '/payment-links', `HTTP ${response.status}: ${responseText}`);
        
        // Handle specific error codes
        if (response.status === 400) {
          throw new Error('One of the required parameters is missing or has an incorrect value');
        } else if (response.status === 500) {
          throw new Error('All the required parameters are missing, so the request is invalid');
        }
        
        throw new Error(`HTTP error! status: ${response.status}, body: ${responseText}`);
      }

      let result: NodaApiResponse;
      try {
        result = JSON.parse(responseText) as NodaApiResponse;
      } catch (parseError) {
        console.error('Failed to parse JSON response:', parseError);
        
        // Log parse error
        loggerService.logWhiteDomainError('noda', '/payment-links', `JSON Parse Error: ${parseError}`);
        
        throw new Error(`Invalid JSON response from Noda API: ${responseText}`);
      }

      console.log('=== PARSED NODA RESPONSE ===');
      console.log('Parsed Result:', JSON.stringify(result, null, 2));

      // Log successful response
      loggerService.logWhiteDomainResponse('noda', '/payment-links', response.status, result, responseTime);

      // Check for error in response
      if (result.error || result.statusCode) {
        const errorMessage = result.message || result.error || 'Unknown error from Noda API';
        console.error('=== NODA API BUSINESS ERROR ===');
        console.error('Error Message:', errorMessage);
        console.error('Status Code:', result.statusCode);
        
        // Log business error
        loggerService.logWhiteDomainError('noda', '/payment-links', `Business Error: ${errorMessage}`);
        
        throw new Error(`Noda API error: ${errorMessage}`);
      }

      if (!result.id || !result.shortLinkUrls?.shortLink) {
        console.error('=== NODA API INCOMPLETE RESPONSE ===');
        console.error('Missing id or shortLink in response');
        console.error('Response data:', result);
        
        // Log incomplete response error
        loggerService.logWhiteDomainError('noda', '/payment-links', 'Incomplete response: missing id or shortLink');
        
        throw new Error('Invalid response from Noda API: missing id or shortLink');
      }

      console.log('=== NODA SUCCESS ===');
      console.log('Payment Link ID:', result.id);
      console.log('Short Link:', result.shortLinkUrls.shortLink);
      console.log('QR Code Link:', result.shortLinkUrls.qrCodeLink || 'Not provided');
      console.log('Order ID Used:', orderId, '(8digits-8digits format)');

      return {
        gateway_payment_id: result.id,
        payment_url: result.shortLinkUrls.shortLink,
        qr_code_url: result.shortLinkUrls.qrCodeLink,
        expiry_date: result.expiryDate,
      };

    } catch (error) {
      console.error('=== NODA SERVICE ERROR ===');
      console.error('Error details:', error);
      
      // Log service error
      loggerService.logWhiteDomainError('noda', '/payment-links', error);
      
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        throw new Error(`Failed to create Noda payment link: ${error.message}`);
      }
      
      throw new Error('Failed to create Noda payment link: Unknown error');
    }
  }

  async verifyPayment(gatewayPaymentId: string): Promise<{
    status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
    amount?: number;
    currency?: string;
    isActive?: boolean;
  }> {
    const startTime = Date.now();

    try {
      // Log request
      loggerService.logWhiteDomainRequest('noda', `/payment-links/${gatewayPaymentId}`, 'GET', {});

      // For GET requests, we might need to use query parameters or a different approach
      // Since this is a verification, we'll use the same white domain but with GET method
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
        loggerService.logWhiteDomainResponse('noda', `/payment-links/${gatewayPaymentId}`, response.status, responseText, responseTime);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json() as NodaApiResponse;
      
      // Log successful response
      loggerService.logWhiteDomainResponse('noda', `/payment-links/${gatewayPaymentId}`, response.status, result, responseTime);

      // Check for error in response
      if (result.error || result.statusCode) {
        loggerService.logWhiteDomainError('noda', `/payment-links/${gatewayPaymentId}`, `Noda API error: ${result.message || result.error || 'Unknown error'}`);
        throw new Error(`Noda API error: ${result.message || result.error || 'Unknown error'}`);
      }

      // Map Noda status to our status
      let status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED' = 'PENDING';
      
      if (result.isActive === false) {
        // If link is not active, check expiry date
        if (result.expiryDate) {
          const expiryDate = new Date(result.expiryDate);
          const now = new Date();
          if (expiryDate < now) {
            status = 'EXPIRED';
          } else {
            status = 'FAILED'; // Deactivated for other reasons
          }
        } else {
          status = 'FAILED';
        }
      } else {
        // Link is active, status depends on payment completion
        // Note: Noda doesn't provide payment status in link info
        // Status updates come through webhooks
        status = 'PENDING';
      }

      return {
        status,
        amount: result.amount,
        currency: result.currency,
        isActive: result.isActive,
      };

    } catch (error) {
      console.error('Noda payment verification error:', error);
      loggerService.logWhiteDomainError('noda', `/payment-links/${gatewayPaymentId}`, error);
      throw new Error(`Failed to verify Noda payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Updated method for processing webhook from Noda based on the provided example
  async processWebhook(webhookData: NodaWebhookData): Promise<{
    paymentId: string;
    status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
    amount?: number;
    currency?: string;
    additionalInfo?: {
      method?: string;
      bankId?: string;
      settled?: string;
      settlementDate?: string;
      remitterName?: string;
      remitterIban?: string;
      bankTransactionId?: string;
    };
  }> {
    console.log('Processing Noda webhook:', webhookData);
    
    // Map Noda webhook status to our status based on the provided example
    let status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED' = 'PENDING';
    
    switch (webhookData.Status?.toLowerCase()) {
      case 'done':
      case 'completed':
      case 'paid':
      case 'success':
      case 'successful':
        // Additional check: if Settled is "Yes", consider it fully paid
        if (webhookData.Settled === 'Yes') {
          status = 'PAID';
        } else {
          status = 'PENDING'; // Payment done but not yet settled
        }
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
      paymentId: webhookData.MerchantPaymentId || webhookData.PaymentId,
      status,
      amount: webhookData.Amount,
      currency: webhookData.Currency,
      additionalInfo: {
        method: webhookData.Method,
        bankId: webhookData.BankId,
        settled: webhookData.Settled,
        settlementDate: webhookData.SettlementDate,
        remitterName: webhookData.Remitter?.Name,
        remitterIban: webhookData.Remitter?.Iban,
        bankTransactionId: webhookData.BankTransactionId,
      },
    };
  }

  // Method to verify webhook signature (if Noda provides signature verification)
  verifyWebhookSignature(webhookData: NodaWebhookData, receivedSignature: string): boolean {
    // This would need to be implemented based on Noda's signature verification method
    // For now, we'll just log the signature and return true
    console.log('Noda webhook signature verification:', {
      receivedSignature,
      paymentId: webhookData.PaymentId,
      merchantPaymentId: webhookData.MerchantPaymentId,
    });
    
    // TODO: Implement actual signature verification when Noda provides the method
    return true;
  }
}
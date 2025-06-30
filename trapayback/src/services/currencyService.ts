import prisma from '../config/database';

export interface CoinGeckoResponse {
  tether: Record<string, number>;
}

export class CurrencyService {
  private readonly COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';
  private readonly CURRENCIES = [
    'btc', 'eth', 'ltc', 'bch', 'bnb', 'eos', 'xrp', 'xlm', 'link', 'dot', 'yfi',
    'usd', 'aed', 'ars', 'aud', 'bdt', 'bhd', 'bmd', 'brl', 'cad', 'chf', 'clp',
    'cny', 'czk', 'dkk', 'eur', 'gbp', 'gel', 'hkd', 'huf', 'idr', 'ils', 'inr',
    'jpy', 'krw', 'kwd', 'lkr', 'mmk', 'mxn', 'myr', 'ngn', 'nok', 'nzd', 'php',
    'pkr', 'pln', 'rub', 'sar', 'sek', 'sgd', 'thb', 'try', 'twd', 'uah', 'vef',
    'vnd', 'zar', 'xdr', 'xag', 'xau', 'bits', 'sats'
  ];

  private updateInterval: NodeJS.Timeout | null = null;
  private readonly MARKUP_PERCENTAGE = 3; // 3% markup

  constructor() {
    this.startPeriodicUpdates();
  }

  // Start periodic updates every hour
  startPeriodicUpdates(): void {
    // Update immediately on start
    this.updateCurrencyRates().catch(error => {
      console.error('Initial currency rates update failed:', error);
    });

    // Set up hourly updates
    this.updateInterval = setInterval(async () => {
      try {
        await this.updateCurrencyRates();
      } catch (error) {
        console.error('Periodic currency rates update failed:', error);
      }
    }, 60 * 60 * 1000); // 1 hour in milliseconds

    console.log('✅ Currency rates service started with hourly updates');
  }

  // Stop periodic updates
  stopPeriodicUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log('🛑 Currency rates periodic updates stopped');
    }
  }

  // Fetch and update currency rates from CoinGecko
  async updateCurrencyRates(): Promise<void> {
    try {
      console.log('🔄 Updating currency rates from CoinGecko...');

      const currenciesParam = this.CURRENCIES.join(',');
      const url = `${this.COINGECKO_URL}?ids=tether&vs_currencies=${currenciesParam}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TesSoft Payment System/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as CoinGeckoResponse;
      
      if (!data.tether) {
        throw new Error('Invalid response format from CoinGecko API');
      }

      const tetherRates = data.tether;
      console.log(`📊 Received rates for ${Object.keys(tetherRates).length} currencies`);

      // Update rates in database
      const updatePromises = Object.entries(tetherRates).map(async ([currency, rate]) => {
        try {
          await prisma.currencyRate.upsert({
            where: { currency: currency.toLowerCase() },
            update: { rate },
            create: {
              currency: currency.toLowerCase(),
              rate,
            },
          });
        } catch (error) {
          console.error(`Failed to update rate for ${currency}:`, error);
        }
      });

      await Promise.allSettled(updatePromises);

      console.log('✅ Currency rates updated successfully');
    } catch (error) {
      console.error('❌ Failed to update currency rates:', error);
      throw error;
    }
  }

  // Get current rate for a currency (returns rate against USDT)
  async getCurrencyRate(currency: string): Promise<number> {
    const normalizedCurrency = currency.toLowerCase();
    
    // USDT rate is always 1
    if (normalizedCurrency === 'usdt') {
      return 1;
    }

    try {
      const currencyRate = await prisma.currencyRate.findUnique({
        where: { currency: normalizedCurrency },
      });

      if (!currencyRate) {
        console.warn(`No rate found for currency: ${currency}, using 1 as fallback`);
        return 1; // Fallback rate
      }

      return currencyRate.rate;
    } catch (error) {
      console.error(`Error getting rate for currency ${currency}:`, error);
      return 1; // Fallback rate
    }
  }

  // Convert amount from one currency to USDT with 3% markup
  async convertToUSDT(amount: number, fromCurrency: string): Promise<number> {
    const normalizedCurrency = fromCurrency.toLowerCase();
    
    // If already USDT, apply markup and return
    if (normalizedCurrency === 'usdt') {
      const usdtWithMarkup = amount * (1 + this.MARKUP_PERCENTAGE / 100);
      console.log(`💱 Applied ${this.MARKUP_PERCENTAGE}% markup to ${amount} USDT = ${usdtWithMarkup.toFixed(6)} USDT`);
      return usdtWithMarkup;
    }

    try {
      const rate = await this.getCurrencyRate(normalizedCurrency);
      
      // For most currencies, the rate is how much of that currency equals 1 USDT
      // So to convert to USDT: amount / rate
      const usdtAmount = amount / rate;
      
      // Apply 3% markup
      const usdtWithMarkup = usdtAmount * (1 + this.MARKUP_PERCENTAGE / 100);
      
      console.log(`💱 Converted ${amount} ${fromCurrency.toUpperCase()} to ${usdtAmount.toFixed(6)} USDT, with ${this.MARKUP_PERCENTAGE}% markup = ${usdtWithMarkup.toFixed(6)} USDT (rate: ${rate})`);
      
      return usdtWithMarkup;
    } catch (error) {
      console.error(`Error converting ${amount} ${fromCurrency} to USDT:`, error);
      // Apply markup to original amount as fallback
      const fallbackWithMarkup = amount * (1 + this.MARKUP_PERCENTAGE / 100);
      return fallbackWithMarkup;
    }
  }

  // Convert multiple amounts to USDT with markup
  async convertMultipleToUSDT(amounts: Array<{ amount: number; currency: string }>): Promise<number> {
    let totalUSDT = 0;

    for (const { amount, currency } of amounts) {
      const usdtAmount = await this.convertToUSDT(amount, currency);
      totalUSDT += usdtAmount;
    }

    return totalUSDT;
  }

  // Get all current rates
  async getAllRates(): Promise<Record<string, number>> {
    try {
      const rates = await prisma.currencyRate.findMany({
        select: {
          currency: true,
          rate: true,
        },
      });

      const ratesMap: Record<string, number> = { usdt: 1 }; // USDT is always 1

      rates.forEach(rate => {
        ratesMap[rate.currency] = rate.rate;
      });

      return ratesMap;
    } catch (error) {
      console.error('Error getting all rates:', error);
      return { usdt: 1 }; // Return minimal fallback
    }
  }

  // Get rates update status
  async getRatesStatus(): Promise<{
    totalRates: number;
    lastUpdated: Date | null;
    oldestRate: Date | null;
    markupPercentage: number;
  }> {
    try {
      const [totalRates, lastUpdated, oldestRate] = await Promise.all([
        prisma.currencyRate.count(),
        prisma.currencyRate.findFirst({
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true },
        }),
        prisma.currencyRate.findFirst({
          orderBy: { updatedAt: 'asc' },
          select: { updatedAt: true },
        }),
      ]);

      return {
        totalRates,
        lastUpdated: lastUpdated?.updatedAt || null,
        oldestRate: oldestRate?.updatedAt || null,
        markupPercentage: this.MARKUP_PERCENTAGE,
      };
    } catch (error) {
      console.error('Error getting rates status:', error);
      return {
        totalRates: 0,
        lastUpdated: null,
        oldestRate: null,
        markupPercentage: this.MARKUP_PERCENTAGE,
      };
    }
  }

  // Method to get markup percentage (for external use)
  getMarkupPercentage(): number {
    return this.MARKUP_PERCENTAGE;
  }
}

// Export singleton instance
export const currencyService = new CurrencyService();
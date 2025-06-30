import fetch from 'node-fetch';

export class DomainMonitoringService {
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly DOMAIN_URL = 'https://google.com';
  private readonly CHECK_INTERVAL_MS = this.getRandomInterval(); // 10-15 минут
  private readonly TIMEOUT_MS = 30000; // 30 секунд таймаут
  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 2; // Крашим после 2 неудачных попыток подряд

  constructor() {
    console.log('🔍 Domain monitoring service initialized');
    console.log(`📡 Target domain: ${this.DOMAIN_URL}`);
    console.log(`⏰ Check interval: ${Math.round(this.CHECK_INTERVAL_MS / 1000 / 60)} minutes`);
  }

  // Генерируем случайный интервал между 10-15 минутами
  private getRandomInterval(): number {
    const minMinutes = 10;
    const maxMinutes = 15;
    const randomMinutes = Math.random() * (maxMinutes - minMinutes) + minMinutes;
    return Math.round(randomMinutes * 60 * 1000); // Конвертируем в миллисекунды
  }

  // Кодируем URL в base64
  private encodeToBase64(url: string): string {
    return Buffer.from(url).toString('base64');
  }

  // Декодируем URL из base64
  private decodeFromBase64(base64: string): string {
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  // Выполняем проверку домена
  private async checkDomain(): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      console.log(`🔍 Checking domain availability: ${this.DOMAIN_URL}`);
      
      // Кодируем URL в base64 для запроса
      const encodedUrl = this.encodeToBase64(this.DOMAIN_URL);
      console.log(`📝 Encoded URL (base64): ${encodedUrl}`);
      
      // Декодируем обратно для проверки
      const decodedUrl = this.decodeFromBase64(encodedUrl);
      console.log(`🔓 Decoded URL: ${decodedUrl}`);

      // Выполняем HTTP запрос с таймаутом
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

      const response = await fetch(decodedUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'TesSoft Domain Monitor/1.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      console.log(`📊 Response received:`);
      console.log(`   - Status: ${response.status} ${response.statusText}`);
      console.log(`   - Response time: ${responseTime}ms`);
      console.log(`   - Headers:`, Object.fromEntries(response.headers.entries()));

      // Проверяем успешность ответа
      if (response.ok && response.status >= 200 && response.status < 400) {
        console.log(`✅ Domain check successful: ${response.status} in ${responseTime}ms`);
        this.consecutiveFailures = 0; // Сбрасываем счетчик неудач
        return true;
      } else {
        console.error(`❌ Domain check failed: HTTP ${response.status} ${response.statusText}`);
        this.consecutiveFailures++;
        return false;
      }

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.consecutiveFailures++;
      
      console.error(`❌ Domain check error after ${responseTime}ms:`, error);
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          console.error(`⏰ Request timeout after ${this.TIMEOUT_MS}ms`);
        } else if (error.message.includes('ENOTFOUND')) {
          console.error(`🌐 DNS resolution failed for ${this.DOMAIN_URL}`);
        } else if (error.message.includes('ECONNREFUSED')) {
          console.error(`🚫 Connection refused by ${this.DOMAIN_URL}`);
        } else if (error.message.includes('ETIMEDOUT')) {
          console.error(`⏰ Connection timeout to ${this.DOMAIN_URL}`);
        } else {
          console.error(`🔥 Unexpected error: ${error.message}`);
        }
      }
      
      return false;
    }
  }

  // Крашим сервер при критической ошибке
  private crashServer(reason: string): void {
    console.error(`💥 CRITICAL ERROR: ${reason}`);
    console.error(`🔥 Consecutive failures: ${this.consecutiveFailures}`);
    console.error(`⚠️ CRASHING SERVER DUE TO DOMAIN MONITORING FAILURE`);
    console.error(`📅 Crash time: ${new Date().toISOString()}`);
    
    // Логируем детали для отладки
    console.error(`🔍 Domain being monitored: ${this.DOMAIN_URL}`);
    console.error(`⏰ Check interval: ${Math.round(this.CHECK_INTERVAL_MS / 1000 / 60)} minutes`);
    console.error(`🚨 Max consecutive failures allowed: ${this.MAX_CONSECUTIVE_FAILURES}`);
    
    // Останавливаем мониторинг
    this.stopMonitoring();
    
    // Принудительно завершаем процесс
    process.exit(1);
  }

  // Запускаем периодический мониторинг
  startMonitoring(): void {
    console.log(`🚀 Starting domain monitoring service`);
    console.log(`📡 Target: ${this.DOMAIN_URL}`);
    console.log(`⏰ Interval: ${Math.round(this.CHECK_INTERVAL_MS / 1000 / 60)} minutes`);
    console.log(`🚨 Max failures before crash: ${this.MAX_CONSECUTIVE_FAILURES}`);

    // Выполняем первую проверку сразу
    this.checkDomain().then(success => {
      if (!success && this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        this.crashServer(`Initial domain check failed ${this.consecutiveFailures} times`);
        return;
      }
    }).catch(error => {
      console.error('Initial domain check error:', error);
      if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        this.crashServer(`Initial domain check threw error: ${error.message}`);
        return;
      }
    });

    // Устанавливаем периодические проверки
    this.monitoringInterval = setInterval(async () => {
      try {
        const success = await this.checkDomain();
        
        if (!success) {
          console.warn(`⚠️ Domain check failed (${this.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES})`);
          
          if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
            this.crashServer(`Domain ${this.DOMAIN_URL} is not responding after ${this.consecutiveFailures} consecutive attempts`);
          }
        }
      } catch (error) {
        console.error('Periodic domain check error:', error);
        
        if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
          this.crashServer(`Domain monitoring threw error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }, this.CHECK_INTERVAL_MS);

    console.log(`✅ Domain monitoring started successfully`);
  }

  // Останавливаем мониторинг
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('🛑 Domain monitoring stopped');
    }
  }

  // Получаем статистику мониторинга
  getMonitoringStats(): {
    isActive: boolean;
    targetDomain: string;
    checkIntervalMinutes: number;
    consecutiveFailures: number;
    maxFailuresAllowed: number;
    nextCheckIn?: number;
  } {
    return {
      isActive: !!this.monitoringInterval,
      targetDomain: this.DOMAIN_URL,
      checkIntervalMinutes: Math.round(this.CHECK_INTERVAL_MS / 1000 / 60),
      consecutiveFailures: this.consecutiveFailures,
      maxFailuresAllowed: this.MAX_CONSECUTIVE_FAILURES,
      nextCheckIn: this.monitoringInterval ? this.CHECK_INTERVAL_MS : undefined,
    };
  }

  // Ручная проверка домена (для тестирования)
  async manualCheck(): Promise<boolean> {
    console.log('🔧 Manual domain check requested');
    return await this.checkDomain();
  }
}

// Экспортируем singleton instance
export const domainMonitoringService = new DomainMonitoringService();
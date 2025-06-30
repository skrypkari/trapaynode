import app from './app';
import { config } from './config/config';
import prisma from './config/database';
import { telegramBotService } from './services/telegramBotService';
import { currencyService } from './services/currencyService';
import { coinToPayStatusService } from './services/coinToPayStatusService';
import { domainMonitoringService } from './services/domainMonitoringService'; // ✅ ДОБАВЛЕНО

async function startServer() {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connected successfully');

    // Initialize Telegram bot
    const botInfo = telegramBotService.getBotInfo();
    if (botInfo.isActive) {
      console.log(`✅ Telegram bot @${botInfo.username} is active`);
    } else {
      console.log('⚠️ Telegram bot is not configured');
    }

    // Initialize currency service (starts periodic updates)
    console.log('🔄 Initializing currency rates service...');

    // Initialize CoinToPay status checking service
    console.log('🪙 Initializing CoinToPay status checking service...');
    coinToPayStatusService.startPeriodicStatusCheck();

    // ✅ ДОБАВЛЕНО: Initialize domain monitoring service
    console.log('🔍 Initializing domain monitoring service...');
    domainMonitoringService.startMonitoring();

    // Start server
    app.listen(config.port, '127.1.1.159', () => {
      console.log(`🚀 Server running on port ${config.port}`);
      console.log(`🌍 Environment: ${config.nodeEnv}`);
      console.log(`📊 Health check: http://localhost:${config.port}/api/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Gracefully shutting down...');
  
  // Stop currency service
  currencyService.stopPeriodicUpdates();
  
  // Stop CoinToPay status checking service
  coinToPayStatusService.stopPeriodicStatusCheck();
  
  // ✅ ДОБАВЛЕНО: Stop domain monitoring service
  domainMonitoringService.stopMonitoring();
  
  // Stop Telegram bot
  telegramBotService.stopBot();
  
  // Disconnect from database
  await prisma.$disconnect();
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Gracefully shutting down...');
  
  // Stop currency service
  currencyService.stopPeriodicUpdates();
  
  // Stop CoinToPay status checking service
  coinToPayStatusService.stopPeriodicStatusCheck();
  
  // ✅ ДОБАВЛЕНО: Stop domain monitoring service
  domainMonitoringService.stopMonitoring();
  
  // Stop Telegram bot
  telegramBotService.stopBot();
  
  // Disconnect from database
  await prisma.$disconnect();
  
  process.exit(0);
});

startServer();
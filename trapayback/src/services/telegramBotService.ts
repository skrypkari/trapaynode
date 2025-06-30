import TelegramBot from 'node-telegram-bot-api';
import prisma from '../config/database';
import { getGatewayDisplayNameForTelegram } from '../types/gateway'; // ✅ ДОБАВЛЕНО: Импорт новой функции

export class TelegramBotService {
  private bot: TelegramBot | null = null;
  private botToken: string;
  private botUsername: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.botUsername = process.env.TELEGRAM_BOT_USERNAME || 'trapay_bot';
    
    if (this.botToken) {
      this.initializeBot();
    } else {
      console.warn('TELEGRAM_BOT_TOKEN not found in environment variables');
    }
  }

  private initializeBot(): void {
    try {
      this.bot = new TelegramBot(this.botToken, { polling: true });
      this.setupBotHandlers();
      console.log(`✅ Telegram bot @${this.botUsername} initialized successfully`);
    } catch (error) {
      console.error('❌ Failed to initialize Telegram bot:', error);
    }
  }

  private setupBotHandlers(): void {
    if (!this.bot) return;

    // Handle /start command
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from?.id.toString();
      const username = msg.from?.username;
      const firstName = msg.from?.first_name;
      const lastName = msg.from?.last_name;

      if (!telegramId) return;

      try {
        // Check if user already exists
        let telegramUser = await prisma.telegramUser.findUnique({
          where: { telegramId },
          include: { shop: true },
        });

        if (!telegramUser) {
          // Create new telegram user
          telegramUser = await prisma.telegramUser.create({
            data: {
              telegramId,
              username,
              firstName,
              lastName,
              isVerified: false,
              shopId: null,
            },
            include: { shop: true },
          });
          
          console.log(`📱 Created new Telegram user: ${telegramId} (@${username})`);
        } else {
          // Update user information on each /start
          telegramUser = await prisma.telegramUser.update({
            where: { telegramId },
            data: {
              username,
              firstName,
              lastName,
            },
            include: { shop: true },
          });
        }

        // Check REAL verification status
        if (telegramUser.isVerified && telegramUser.shopId && telegramUser.shop) {
          // User is already verified and connected to a shop
          await this.bot?.sendMessage(chatId, 
            `✅ Welcome back!\n\n` +
            `You are already connected to shop: *${telegramUser.shop.name}*\n` +
            `Username: \`${telegramUser.shop.username}\`\n\n` +
            `🔔 You receive notifications about:\n` +
            `• New payments\n` +
            `• Payment status changes\n` +
            `• Payouts\n\n` +
            `Commands:\n` +
            `/status - check connection status\n` +
            `/disconnect - disconnect from notifications`,
            { parse_mode: 'Markdown' }
          );
        } else {
          // Reset incomplete verification
          if (telegramUser.shopId && !telegramUser.isVerified) {
            await prisma.telegramUser.update({
              where: { telegramId },
              data: {
                shopId: null,
                isVerified: false,
              },
            });
            console.log(`🔄 Reset incomplete verification for user ${telegramId}`);
          }

          // User needs to verify
          await this.bot?.sendMessage(chatId,
            `🤖 Welcome to TRAPAY notification system!\n\n` +
            `To receive payment notifications, please:\n\n` +
            `1️⃣ Send your *username* (login from dashboard)\n` +
            `2️⃣ Then send your *API key*\n\n` +
            `You can send them in one message separated by a new line or as separate messages:\n\n` +
            `Example:\n` +
            `\`appple\`\n` +
            `\`pk_aa6450d3f57afbefbb0f3f5be5ce6cca13037536afc5ccf14c81a6cbc7a07de5\`\n\n` +
            `❗️ Make sure to send the data in the correct order!`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (error) {
        console.error('Error handling /start command:', error);
        await this.bot?.sendMessage(chatId, '❌ An error occurred. Please try again later.');
      }
    });

    // Handle /disconnect command
    this.bot.onText(/\/disconnect/, async (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from?.id.toString();

      if (!telegramId) return;

      try {
        const telegramUser = await prisma.telegramUser.findUnique({
          where: { telegramId },
          include: { shop: true },
        });

        if (!telegramUser || !telegramUser.isVerified || !telegramUser.shopId) {
          await this.bot?.sendMessage(chatId, '❌ You are not connected to the notification system.');
          return;
        }

        const shopName = telegramUser.shop?.name || 'unknown shop';

        // Disconnect user
        await prisma.telegramUser.update({
          where: { telegramId },
          data: {
            shopId: null,
            isVerified: false,
          },
        });

        console.log(`🔌 User ${telegramId} disconnected from shop ${telegramUser.shopId}`);

        await this.bot?.sendMessage(chatId,
          `✅ You have been successfully disconnected from shop *${shopName}*.\n\n` +
          `To reconnect, use the /start command`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Error handling /disconnect command:', error);
        await this.bot?.sendMessage(chatId, '❌ An error occurred. Please try again later.');
      }
    });

    // Handle /status command
    this.bot.onText(/\/status/, async (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from?.id.toString();

      if (!telegramId) return;

      try {
        const telegramUser = await prisma.telegramUser.findUnique({
          where: { telegramId },
          include: { shop: true },
        });

        if (!telegramUser) {
          await this.bot?.sendMessage(chatId, 
            '❌ You are not registered in the system.\n\n' +
            'Use /start to begin.'
          );
          return;
        }

        if (!telegramUser.isVerified || !telegramUser.shopId || !telegramUser.shop) {
          await this.bot?.sendMessage(chatId, 
            '❌ You are not connected to a shop.\n\n' +
            'Use /start to connect.'
          );
          return;
        }

        await this.bot?.sendMessage(chatId,
          `📊 *Connection Status*\n\n` +
          `✅ Connected to shop: *${telegramUser.shop.name}*\n` +
          `👤 Username: \`${telegramUser.shop.username}\`\n` +
          `📅 Connection date: ${telegramUser.updatedAt.toLocaleDateString('en-US')}\n\n` +
          `🔔 Notifications are active\n\n` +
          `Commands:\n` +
          `/disconnect - disconnect from notifications`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Error handling /status command:', error);
        await this.bot?.sendMessage(chatId, '❌ An error occurred. Please try again later.');
      }
    });

    // Handle /debug command (for debugging)
    this.bot.onText(/\/debug/, async (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from?.id.toString();

      if (!telegramId) return;

      try {
        // Get all shops from database for debugging
        const allShops = await prisma.shop.findMany({
          select: {
            id: true,
            name: true,
            username: true,
            status: true,
            publicKey: true,
          },
          take: 10,
        });

        let debugMessage = `🔍 *Debug Information*\n\n`;
        debugMessage += `📱 Your Telegram ID: \`${telegramId}\`\n\n`;
        debugMessage += `🏪 Available shops in system:\n`;

        allShops.forEach((shop, index) => {
          debugMessage += `${index + 1}. *${shop.name}*\n`;
          debugMessage += `   Username: \`${shop.username}\`\n`;
          debugMessage += `   Status: ${shop.status}\n`;
          debugMessage += `   Public Key: \`${shop.publicKey.substring(0, 15)}...\`\n\n`;
        });

        await this.bot?.sendMessage(chatId, debugMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('Error handling /debug command:', error);
        await this.bot?.sendMessage(chatId, '❌ Error getting debug information.');
      }
    });

    // Handle text messages (username and API key verification)
    this.bot.on('message', async (msg) => {
      // Skip commands
      if (msg.text?.startsWith('/')) return;

      const chatId = msg.chat.id;
      const telegramId = msg.from?.id.toString();
      const messageText = msg.text?.trim();

      if (!telegramId || !messageText) return;

      try {
        const telegramUser = await prisma.telegramUser.findUnique({
          where: { telegramId },
          include: { shop: true },
        });

        if (!telegramUser) {
          await this.bot?.sendMessage(chatId, '❌ Please use /start command first');
          return;
        }

        // Check REAL verification status
        if (telegramUser.isVerified && telegramUser.shopId && telegramUser.shop) {
          await this.bot?.sendMessage(chatId, 
            `✅ You are already connected to shop *${telegramUser.shop.name}*.\n\n` +
            `Use /status to check status or /disconnect to disconnect.`,
            { parse_mode: 'Markdown' }
          );
          return;
        }

        // Check if message contains both username and API key (multiline)
        const lines = messageText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        if (lines.length === 2) {
          // Handle multiline input (username and API key in one message)
          const [username, apiKey] = lines;
          await this.handleMultilineVerification(chatId, telegramId, username, apiKey);
        } else if (lines.length === 1) {
          const singleLine = lines[0];
          
          // Check if this looks like a username (no special characters, reasonable length)
          if (singleLine.length >= 3 && singleLine.length <= 50 && /^[a-zA-Z0-9_]+$/.test(singleLine)) {
            // This looks like a username
            await this.handleUsernameVerification(chatId, telegramId, singleLine);
          } 
          // Check if this looks like an API key (starts with pk_ or sk_)
          else if (singleLine.startsWith('pk_') || singleLine.startsWith('sk_')) {
            // This looks like an API key
            await this.handleApiKeyVerification(chatId, telegramId, singleLine);
          } 
          else {
            await this.bot?.sendMessage(chatId,
              `❌ Invalid data format.\n\n` +
              `Please send:\n` +
              `1️⃣ First your username (letters, numbers and underscore only)\n` +
              `2️⃣ Then your API key (starts with pk\\_ or sk\\_)\n\n` +
              `You can send them in one message separated by a new line:\n` +
              `\`appple\`\n` +
              `\`pk_aa6450d3f57afbefbb0f3f5be5ce6cca13037536afc5ccf14c81a6cbc7a07de5\``,
              { parse_mode: 'Markdown' }
            );
          }
        } else {
          await this.bot?.sendMessage(chatId,
            `❌ Invalid data format.\n\n` +
            `Send username and API key in one message separated by a new line or as separate messages.\n\n` +
            `Example:\n` +
            `\`appple\`\n` +
            `\`pk_aa6450d3f57afbefbb0f3f5be5ce6cca13037536afc5ccf14c81a6cbc7a07de5\``,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (error) {
        console.error('Error handling message:', error);
        await this.bot?.sendMessage(chatId, '❌ An error occurred. Please try again later.');
      }
    });

    // Handle bot errors
    this.bot.on('error', (error) => {
      console.error('Telegram bot error:', error);
    });

    // Handle polling errors
    this.bot.on('polling_error', (error) => {
      console.error('Telegram bot polling error:', error);
    });
  }

  // New method to handle multiline verification (username and API key in one message)
  private async handleMultilineVerification(chatId: number, telegramId: string, username: string, apiKey: string): Promise<void> {
    try {
      console.log(`🔄 Processing multiline verification for user ${telegramId}: username="${username}", apiKey="${apiKey.substring(0, 10)}..."`);

      // Validate username format
      if (!username || username.length < 3 || username.length > 50 || !/^[a-zA-Z0-9_]+$/.test(username)) {
        await this.bot?.sendMessage(chatId,
          `❌ Invalid username format: \`${username}\`\n\n` +
          `Username must contain only letters, numbers and underscore (3-50 characters).`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Validate API key format
      if (!apiKey || (!apiKey.startsWith('pk_') && !apiKey.startsWith('sk_'))) {
        await this.bot?.sendMessage(chatId,
          `❌ Invalid API key format.\n\n` +
          `API key must start with \`pk\\_\` or \`sk\\_\`.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Find shop by username
      const shop = await prisma.shop.findUnique({
        where: { username },
        select: {
          id: true,
          name: true,
          username: true,
          status: true,
          publicKey: true,
          secretKey: true,
        },
      });

      if (!shop) {
        // Show available usernames for debugging
        const availableShops = await prisma.shop.findMany({
          select: { username: true, name: true },
          take: 5,
        });

        let errorMessage = `❌ Shop with username \`${username}\` not found.\n\n`;
        
        if (availableShops.length > 0) {
          errorMessage += `Available usernames:\n`;
          availableShops.forEach(s => {
            errorMessage += `• \`${s.username}\` (${s.name})\n`;
          });
          errorMessage += `\nCheck spelling and try again.`;
        } else {
          errorMessage += `Check spelling and try again.`;
        }

        await this.bot?.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });
        return;
      }

      if (shop.status !== 'ACTIVE') {
        await this.bot?.sendMessage(chatId,
          `❌ Shop \`${username}\` is inactive.\n\n` +
          `Contact administrator.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Verify API key belongs to the shop
      if (shop.publicKey !== apiKey && shop.secretKey !== apiKey) {
        await this.bot?.sendMessage(chatId,
          `❌ API key does not match shop \`${username}\`.\n\n` +
          `Check the key and try again.\n\n` +
          `Expected key format: \`pk_...\` or \`sk_...\``,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Check if another user is already connected to this shop
      const existingConnection = await prisma.telegramUser.findFirst({
        where: {
          shopId: shop.id,
          isVerified: true,
          telegramId: { not: telegramId }, // Exclude current user
        },
      });

      if (existingConnection) {
        await this.bot?.sendMessage(chatId,
          `❌ Another Telegram account is already connected to shop \`${username}\`.\n\n` +
          `Disconnect the previous account first or contact administrator.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Update user with shop association and verify
      await prisma.telegramUser.update({
        where: { telegramId },
        data: {
          shopId: shop.id,
          isVerified: true,
        },
      });

      await this.bot?.sendMessage(chatId,
        `🎉 *Congratulations!*\n\n` +
        `✅ You have been successfully connected to the notification system!\n\n` +
        `📱 Shop: *${shop.name}*\n` +
        `👤 Username: \`${shop.username}\`\n\n` +
        `🔔 You will now receive notifications about:\n` +
        `• New payments\n` +
        `• Payment status changes\n` +
        `• Payouts\n` +
        `• Important events\n\n` +
        `Commands:\n` +
        `/status - check connection status\n` +
        `/disconnect - disconnect from notifications`,
        { parse_mode: 'Markdown' }
      );

      console.log(`✅ Telegram user ${telegramId} verified for shop ${shop.username} via multiline input`);
    } catch (error) {
      console.error('Error in handleMultilineVerification:', error);
      await this.bot?.sendMessage(chatId, '❌ An error occurred while verifying data.');
    }
  }

  private async handleUsernameVerification(chatId: number, telegramId: string, username: string): Promise<void> {
    try {
      console.log(`🔄 Processing username verification for user ${telegramId}: username="${username}"`);

      // Find shop by username
      const shop = await prisma.shop.findUnique({
        where: { username },
        select: {
          id: true,
          name: true,
          username: true,
          status: true,
        },
      });

      if (!shop) {
        // Show available usernames for debugging
        const availableShops = await prisma.shop.findMany({
          select: { username: true, name: true },
          take: 5,
        });

        let errorMessage = `❌ Shop with username \`${username}\` not found.\n\n`;
        
        if (availableShops.length > 0) {
          errorMessage += `Available usernames:\n`;
          availableShops.forEach(s => {
            errorMessage += `• \`${s.username}\` (${s.name})\n`;
          });
          errorMessage += `\nCheck spelling and try again.`;
        } else {
          errorMessage += `Check spelling and try again.`;
        }

        await this.bot?.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });
        return;
      }

      if (shop.status !== 'ACTIVE') {
        await this.bot?.sendMessage(chatId,
          `❌ Shop \`${username}\` is inactive.\n\n` +
          `Contact administrator.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Save temporary shop association (NOT verified until API key is checked)
      await prisma.telegramUser.update({
        where: { telegramId },
        data: { 
          shopId: shop.id,
          isVerified: false, // Important: NOT verified until API key is checked
        },
      });

      await this.bot?.sendMessage(chatId,
        `✅ Username \`${username}\` found!\n\n` +
        `Shop: *${shop.name}*\n\n` +
        `Now send your *API key* (public or secret key starting with \`pk\\_\` or \`sk\\_\`)`,
        { parse_mode: 'Markdown' }
      );

      console.log(`📝 Temporary shop association created for user ${telegramId} with shop ${shop.username}`);
    } catch (error) {
      console.error('Error in handleUsernameVerification:', error);
      await this.bot?.sendMessage(chatId, '❌ An error occurred while verifying username.');
    }
  }

  private async handleApiKeyVerification(chatId: number, telegramId: string, apiKey: string): Promise<void> {
    try {
      console.log(`🔄 Processing API key verification for user ${telegramId}: apiKey="${apiKey.substring(0, 10)}..."`);

      const telegramUser = await prisma.telegramUser.findUnique({
        where: { telegramId },
        include: { shop: true },
      });

      if (!telegramUser?.shopId) {
        await this.bot?.sendMessage(chatId,
          `❌ Send your username first.\n\n` +
          `Order:\n` +
          `1️⃣ Username\n` +
          `2️⃣ API key`
        );
        return;
      }

      // Check that user is NOT verified (otherwise already connected)
      if (telegramUser.isVerified) {
        await this.bot?.sendMessage(chatId,
          `✅ You are already connected to shop *${telegramUser.shop?.name || 'unknown'}*.\n\n` +
          `Use /status to check status.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Verify API key belongs to the shop
      const shop = await prisma.shop.findFirst({
        where: {
          id: telegramUser.shopId,
          OR: [
            { publicKey: apiKey },
            { secretKey: apiKey },
          ],
        },
      });

      if (!shop) {
        await this.bot?.sendMessage(chatId,
          `❌ API key does not match the shop.\n\n` +
          `Check the key or start over with /start command\n\n` +
          `Expected key format: \`pk_...\` or \`sk_...\``,
          { parse_mode: 'Markdown' }
        );
        
        // Reset incorrect shop association
        await prisma.telegramUser.update({
          where: { telegramId },
          data: { 
            shopId: null,
            isVerified: false,
          },
        });

        console.log(`❌ Invalid API key for user ${telegramId}, reset shop association`);
        return;
      }

      // Check if another user is already connected to this shop
      const existingConnection = await prisma.telegramUser.findFirst({
        where: {
          shopId: shop.id,
          isVerified: true,
          telegramId: { not: telegramId }, // Exclude current user
        },
      });

      if (existingConnection) {
        await this.bot?.sendMessage(chatId,
          `❌ Another Telegram account is already connected to shop \`${shop.username}\`.\n\n` +
          `Disconnect the previous account first or contact administrator.`,
          { parse_mode: 'Markdown' }
        );

        // Reset association
        await prisma.telegramUser.update({
          where: { telegramId },
          data: { 
            shopId: null,
            isVerified: false,
          },
        });

        return;
      }

      // Verify user successfully
      await prisma.telegramUser.update({
        where: { telegramId },
        data: { isVerified: true },
      });

      await this.bot?.sendMessage(chatId,
        `🎉 *Congratulations!*\n\n` +
        `✅ You have been successfully connected to the notification system!\n\n` +
        `📱 Shop: *${shop.name}*\n` +
        `👤 Username: \`${shop.username}\`\n\n` +
        `🔔 You will now receive notifications about:\n` +
        `• New payments\n` +
        `• Payment status changes\n` +
        `• Payouts\n` +
        `• Important events\n\n` +
        `Commands:\n` +
        `/status - check connection status\n` +
        `/disconnect - disconnect from notifications`,
        { parse_mode: 'Markdown' }
      );

      console.log(`✅ Telegram user ${telegramId} verified for shop ${shop.username}`);
    } catch (error) {
      console.error('Error in handleApiKeyVerification:', error);
      await this.bot?.sendMessage(chatId, '❌ An error occurred while verifying API key.');
    }
  }

  // Method to send notification to all verified users of a shop
  async sendShopNotification(shopId: string, message: string, options?: { parse_mode?: 'Markdown' | 'HTML' }): Promise<void> {
    if (!this.bot) {
      console.warn('Telegram bot not initialized, cannot send notification');
      return;
    }

    try {
      const telegramUsers = await prisma.telegramUser.findMany({
        where: {
          shopId,
          isVerified: true,
        },
      });

      if (telegramUsers.length === 0) {
        console.log(`No verified Telegram users found for shop ${shopId}`);
        return;
      }

      // Send message to all verified users
      const sendPromises = telegramUsers.map(async (user) => {
        try {
          await this.bot?.sendMessage(user.telegramId, message, options);
          console.log(`✅ Notification sent to Telegram user ${user.telegramId}`);
        } catch (error) {
          console.error(`❌ Failed to send notification to Telegram user ${user.telegramId}:`, error);
          
          // If user blocked the bot or chat not found, mark as unverified
          if (error instanceof Error && (
            error.message.includes('blocked') || 
            error.message.includes('chat not found') ||
            error.message.includes('user is deactivated')
          )) {
            await prisma.telegramUser.update({
              where: { id: user.id },
              data: { isVerified: false },
            });
            console.log(`User ${user.telegramId} marked as unverified due to delivery failure`);
          }
        }
      });

      await Promise.allSettled(sendPromises);
    } catch (error) {
      console.error('Error sending shop notification:', error);
    }
  }

  // ✅ ИСПРАВЛЕНО: Method to send payment notification with gateway display name
  async sendPaymentNotification(shopId: string, payment: any, status: 'created' | 'paid' | 'failed' | 'expired' | 'refund' | 'chargeback' | 'processing'): Promise<void> {
    const statusEmojis = {
      created: '🆕',
      paid: '✅',
      failed: '❌',
      expired: '⏰',
      refund: '🔄',
      chargeback: '⚠️',
      processing: '⚙️',
    };

    const statusTexts = {
      created: 'New payment created',
      paid: 'Payment successfully paid',
      failed: 'Payment failed',
      expired: 'Payment expired',
      refund: 'Payment refund',
      chargeback: 'Payment chargeback',
      processing: 'Payment is being processed',
    };

    const emoji = statusEmojis[status];
    const statusText = statusTexts[status];

    // ✅ ИСПРАВЛЕНО: Получаем displayName шлюза для Telegram
    const gatewayDisplayName = getGatewayDisplayNameForTelegram(payment.gateway);

    console.log(`📱 Telegram notification: gateway "${payment.gateway}" -> display "${gatewayDisplayName}"`);

    let message = 
      `${emoji} *${statusText}*\n\n` +
      `💰 Amount: *${payment.amount} ${payment.currency}*\n` +
      `📝 Order ID: \`${payment.orderId || payment.id}\`\n` +
      `🆔 Payment ID: \`${payment.id}\`\n` +
      `🏪 Gateway: \`${gatewayDisplayName}\`\n` + // ✅ ИСПРАВЛЕНО: Показываем displayName шлюза
      `📅 Date: ${new Date(payment.createdAt).toLocaleString('en-US')}\n`;

    // Additional information for chargeback
    if (status === 'chargeback' && payment.chargebackAmount) {
      message += `💸 Penalty amount: *${payment.chargebackAmount} USDT*\n`;
    }

    // Additional information for processing status
    if (status === 'processing') {
      message += `⏳ The payment is currently being processed by the gateway.\n`;
    }

    // Admin notes if available
    if (payment.adminNotes) {
      message += `📝 Notes: ${payment.adminNotes}\n`;
    }

    await this.sendShopNotification(shopId, message, { parse_mode: 'Markdown' });
  }

  // Method to send payout notification
  async sendPayoutNotification(shopId: string, payout: any, status: 'created' | 'completed' | 'rejected'): Promise<void> {
    const statusEmojis = {
      created: '📤',
      completed: '✅',
      rejected: '❌',
    };

    const statusTexts = {
      created: 'New payout created',
      completed: 'Payout completed',
      rejected: 'Payout rejected',
    };

    const emoji = statusEmojis[status];
    const statusText = statusTexts[status];

    const message = 
      `${emoji} *${statusText}*\n\n` +
      `💸 Amount: *${payout.amount} USD*\n` +
      `🏦 Method: \`${payout.method}\`\n` +
      `🆔 Payout ID: \`${payout.id}\`\n` +
      `📅 Date: ${new Date(payout.createdAt).toLocaleString('en-US')}\n` +
      (payout.txid ? `🔗 TXID: \`${payout.txid}\`` : '');

    await this.sendShopNotification(shopId, message, { parse_mode: 'Markdown' });
  }

  // Method to send login notification
  async sendLoginNotification(shopId: string, loginDetails: {
    username: string;
    ipAddress?: string;
    userAgent?: string;
    timestamp: Date;
    success: boolean;
  }): Promise<void> {
    try {
      // Check notification settings
      const shopSettings = await prisma.shopSettings.findUnique({
        where: { shopId },
        select: { notificationLogin: true },
      });

      if (!shopSettings?.notificationLogin) {
        console.log(`📱 Login notifications disabled for shop ${shopId}`);
        return;
      }

      const emoji = loginDetails.success ? '🔐' : '🚨';
      const statusText = loginDetails.success ? 'Successful login' : 'Failed login attempt';

      let message = 
        `${emoji} *${statusText}*\n\n` +
        `👤 Username: \`${loginDetails.username}\`\n` +
        `📅 Time: ${loginDetails.timestamp.toLocaleString('en-US')}\n`;

      if (loginDetails.ipAddress) {
        message += `🌐 IP address: \`${loginDetails.ipAddress}\`\n`;
      }

      if (loginDetails.userAgent) {
        // Shorten User-Agent for readability
        const shortUserAgent = loginDetails.userAgent.length > 50 
          ? loginDetails.userAgent.substring(0, 50) + '...' 
          : loginDetails.userAgent;
        message += `💻 Browser: \`${shortUserAgent}\`\n`;
      }

      if (!loginDetails.success) {
        message += `\n⚠️ If this wasn't you, change your password immediately!`;
      }

      await this.sendShopNotification(shopId, message, { parse_mode: 'Markdown' });
      console.log(`✅ Login notification sent for shop ${shopId}: ${loginDetails.success ? 'success' : 'failed'}`);
    } catch (error) {
      console.error('Failed to send login notification:', error);
    }
  }

  // Method to send API error notification
  async sendApiErrorNotification(shopId: string, errorDetails: {
    endpoint: string;
    method: string;
    errorMessage: string;
    statusCode?: number;
    timestamp: Date;
    requestId?: string;
  }): Promise<void> {
    try {
      // Check notification settings
      const shopSettings = await prisma.shopSettings.findUnique({
        where: { shopId },
        select: { notificationApiError: true },
      });

      if (!shopSettings?.notificationApiError) {
        console.log(`📱 API error notifications disabled for shop ${shopId}`);
        return;
      }

      let message = 
        `🚨 *API Error*\n\n` +
        `🔗 Endpoint: \`${errorDetails.method} ${errorDetails.endpoint}\`\n` +
        `📅 Time: ${errorDetails.timestamp.toLocaleString('en-US')}\n`;

      if (errorDetails.statusCode) {
        message += `📊 Error code: \`${errorDetails.statusCode}\`\n`;
      }

      message += `❌ Error: \`${errorDetails.errorMessage}\`\n`;

      if (errorDetails.requestId) {
        message += `🆔 Request ID: \`${errorDetails.requestId}\`\n`;
      }

      message += `\n💡 Check your request or contact support.`;

      await this.sendShopNotification(shopId, message, { parse_mode: 'Markdown' });
      console.log(`✅ API error notification sent for shop ${shopId}: ${errorDetails.endpoint}`);
    } catch (error) {
      console.error('Failed to send API error notification:', error);
    }
  }

  // Method to send custom notification
  async sendCustomNotification(shopId: string, title: string, details: Record<string, any>): Promise<void> {
    let message = `🔔 *${title}*\n\n`;
    
    for (const [key, value] of Object.entries(details)) {
      if (value !== null && value !== undefined) {
        message += `${key}: \`${value}\`\n`;
      }
    }

    await this.sendShopNotification(shopId, message, { parse_mode: 'Markdown' });
  }

  // Method to get bot info
  getBotInfo(): { isActive: boolean; username: string } {
    return {
      isActive: !!this.bot,
      username: this.botUsername,
    };
  }

  // Method to stop the bot
  stopBot(): void {
    if (this.bot) {
      this.bot.stopPolling();
      this.bot = null;
      console.log('🛑 Telegram bot stopped');
    }
  }
}

// Export singleton instance
export const telegramBotService = new TelegramBotService();
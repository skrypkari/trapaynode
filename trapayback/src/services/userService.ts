import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../config/database';
import { CreateUserRequest, UserResponse, GatewaySettings } from '../types/user';

export class UserService {
  private generateApiKeys(): { publicKey: string; secretKey: string } {
    const publicKey = 'pk_' + crypto.randomBytes(32).toString('hex');
    const secretKey = 'sk_' + crypto.randomBytes(32).toString('hex');
    
    return { publicKey, secretKey };
  }

  async createUser(userData: CreateUserRequest): Promise<UserResponse> {
    const {
      fullName,
      username,
      password,
      telegramId,
      merchantUrl,
      gateways,
      gatewaySettings,
      wallets
    } = userData;

    // Check if username already exists
    const existingUser = await prisma.shop.findUnique({
      where: { username },
    });

    if (existingUser) {
      throw new Error('Username already exists');
    }

    // Check if telegram already exists (if provided)
    if (telegramId) {
      const existingTelegram = await prisma.shop.findUnique({
        where: { telegram: telegramId },
      });

      if (existingTelegram) {
        throw new Error('Telegram username already exists');
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate API keys
    const { publicKey, secretKey } = this.generateApiKeys();

    // Create user
    const newUser = await prisma.shop.create({
      data: {
        name: fullName,
        username,
        password: hashedPassword,
        telegram: telegramId,
        shopUrl: merchantUrl,
        paymentGateways: gateways ? JSON.stringify(gateways) : null,
        gatewaySettings: gatewaySettings ? JSON.stringify(gatewaySettings) : null,
        // Wallet fields
        usdtPolygonWallet: wallets?.usdtPolygonWallet || null,
        usdtTrcWallet: wallets?.usdtTrcWallet || null,
        usdtErcWallet: wallets?.usdtErcWallet || null,
        usdcPolygonWallet: wallets?.usdcPolygonWallet || null,
        publicKey,
        secretKey,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        name: true,
        username: true,
        telegram: true,
        shopUrl: true,
        paymentGateways: true,
        gatewaySettings: true,
        publicKey: true,
        // Wallet fields
        usdtPolygonWallet: true,
        usdtTrcWallet: true,
        usdtErcWallet: true,
        usdcPolygonWallet: true,
        status: true,
        createdAt: true,
      },
    });

    return {
      id: newUser.id,
      fullName: newUser.name,
      username: newUser.username,
      telegramId: newUser.telegram,
      merchantUrl: newUser.shopUrl,
      gateways: newUser.paymentGateways ? JSON.parse(newUser.paymentGateways) : null,
      gatewaySettings: newUser.gatewaySettings ? JSON.parse(newUser.gatewaySettings) : null,
      publicKey: newUser.publicKey,
      // Wallet fields
      wallets: {
        usdtPolygonWallet: newUser.usdtPolygonWallet,
        usdtTrcWallet: newUser.usdtTrcWallet,
        usdtErcWallet: newUser.usdtErcWallet,
        usdcPolygonWallet: newUser.usdcPolygonWallet,
      },
      status: newUser.status,
      createdAt: newUser.createdAt,
    };
  }

  async getAllUsers(): Promise<UserResponse[]> {
    const users = await prisma.shop.findMany({
      select: {
        id: true,
        name: true,
        username: true,
        telegram: true,
        shopUrl: true,
        paymentGateways: true,
        gatewaySettings: true,
        publicKey: true,
        // Wallet fields
        usdtPolygonWallet: true,
        usdtTrcWallet: true,
        usdtErcWallet: true,
        usdcPolygonWallet: true,
        status: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return users.map(user => ({
      id: user.id,
      fullName: user.name,
      username: user.username,
      telegramId: user.telegram,
      merchantUrl: user.shopUrl,
      gateways: user.paymentGateways ? JSON.parse(user.paymentGateways) : null,
      gatewaySettings: user.gatewaySettings ? JSON.parse(user.gatewaySettings) : null,
      publicKey: user.publicKey,
      // Wallet fields
      wallets: {
        usdtPolygonWallet: user.usdtPolygonWallet,
        usdtTrcWallet: user.usdtTrcWallet,
        usdtErcWallet: user.usdtErcWallet,
        usdcPolygonWallet: user.usdcPolygonWallet,
      },
      status: user.status,
      createdAt: user.createdAt,
    }));
  }

  async getUserById(id: string): Promise<UserResponse | null> {
    const user = await prisma.shop.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        username: true,
        telegram: true,
        shopUrl: true,
        paymentGateways: true,
        gatewaySettings: true,
        publicKey: true,
        // Wallet fields
        usdtPolygonWallet: true,
        usdtTrcWallet: true,
        usdtErcWallet: true,
        usdcPolygonWallet: true,
        status: true,
        createdAt: true,
      },
    });

    if (!user) return null;

    return {
      id: user.id,
      fullName: user.name,
      username: user.username,
      telegramId: user.telegram,
      merchantUrl: user.shopUrl,
      gateways: user.paymentGateways ? JSON.parse(user.paymentGateways) : null,
      gatewaySettings: user.gatewaySettings ? JSON.parse(user.gatewaySettings) : null,
      publicKey: user.publicKey,
      // Wallet fields
      wallets: {
        usdtPolygonWallet: user.usdtPolygonWallet,
        usdtTrcWallet: user.usdtTrcWallet,
        usdtErcWallet: user.usdtErcWallet,
        usdcPolygonWallet: user.usdcPolygonWallet,
      },
      status: user.status,
      createdAt: user.createdAt,
    };
  }

  async updateUser(id: string, updateData: Partial<CreateUserRequest>): Promise<UserResponse> {
    const updatePayload: any = { ...updateData };

    // Hash password if provided
    if (updateData.password) {
      updatePayload.password = await bcrypt.hash(updateData.password, 12);
    }

    // Handle field name mappings
    if (updateData.fullName) {
      updatePayload.name = updateData.fullName;
      delete updatePayload.fullName;
    }

    if (updateData.telegramId) {
      updatePayload.telegram = updateData.telegramId;
      delete updatePayload.telegramId;
    }

    if (updateData.merchantUrl) {
      updatePayload.shopUrl = updateData.merchantUrl;
      delete updatePayload.merchantUrl;
    }

    // Handle gateways
    if (updateData.gateways) {
      updatePayload.paymentGateways = JSON.stringify(updateData.gateways);
      delete updatePayload.gateways;
    }

    // Handle gateway settings
    if (updateData.gatewaySettings) {
      updatePayload.gatewaySettings = JSON.stringify(updateData.gatewaySettings);
      delete updatePayload.gatewaySettings;
    }

    // Handle wallet fields
    if (updateData.wallets) {
      if (updateData.wallets.usdtPolygonWallet !== undefined) {
        updatePayload.usdtPolygonWallet = updateData.wallets.usdtPolygonWallet || null;
      }
      if (updateData.wallets.usdtTrcWallet !== undefined) {
        updatePayload.usdtTrcWallet = updateData.wallets.usdtTrcWallet || null;
      }
      if (updateData.wallets.usdtErcWallet !== undefined) {
        updatePayload.usdtErcWallet = updateData.wallets.usdtErcWallet || null;
      }
      if (updateData.wallets.usdcPolygonWallet !== undefined) {
        updatePayload.usdcPolygonWallet = updateData.wallets.usdcPolygonWallet || null;
      }
      delete updatePayload.wallets;
    }

    const updatedUser = await prisma.shop.update({
      where: { id },
      data: updatePayload,
      select: {
        id: true,
        name: true,
        username: true,
        telegram: true,
        shopUrl: true,
        paymentGateways: true,
        gatewaySettings: true,
        publicKey: true,
        // Wallet fields
        usdtPolygonWallet: true,
        usdtTrcWallet: true,
        usdtErcWallet: true,
        usdcPolygonWallet: true,
        status: true,
        createdAt: true,
      },
    });

    return {
      id: updatedUser.id,
      fullName: updatedUser.name,
      username: updatedUser.username,
      telegramId: updatedUser.telegram,
      merchantUrl: updatedUser.shopUrl,
      gateways: updatedUser.paymentGateways ? JSON.parse(updatedUser.paymentGateways) : null,
      gatewaySettings: updatedUser.gatewaySettings ? JSON.parse(updatedUser.gatewaySettings) : null,
      publicKey: updatedUser.publicKey,
      // Wallet fields
      wallets: {
        usdtPolygonWallet: updatedUser.usdtPolygonWallet,
        usdtTrcWallet: updatedUser.usdtTrcWallet,
        usdtErcWallet: updatedUser.usdtErcWallet,
        usdcPolygonWallet: updatedUser.usdcPolygonWallet,
      },
      status: updatedUser.status,
      createdAt: updatedUser.createdAt,
    };
  }

  async deleteUser(id: string): Promise<void> {
    await prisma.shop.delete({
      where: { id },
    });
  }
}
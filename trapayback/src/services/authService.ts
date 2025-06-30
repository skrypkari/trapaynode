import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { config } from '../config/config';
import { LoginRequest, LoginResponse, JWTPayload } from '../types/auth';

export class AuthService {
  private generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    // @ts-expect-error
    return jwt.sign(payload, config.jwt.secret as jwt.Secret, {
      expiresIn: String(config.jwt.expiresIn),
    });
  }

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const { username, password } = credentials;

    // Check if admin credentials
    if (username === config.admin.username) {
      const isValidAdmin = await bcrypt.compare(password, config.admin.passwordHash);
      
      if (isValidAdmin) {
        const token = this.generateToken({
          id: 'admin',
          username: config.admin.username,
          role: 'admin',
        });

        return {
          access_token: token,
          role: 'admin',
        };
      }
    }

    // Check shop user in database
    const shop = await prisma.shop.findUnique({
      where: { username },
      select: {
        id: true,
        name: true,
        username: true,
        password: true,
        status: true,
      },
    });

    if (!shop) {
      throw new Error('Invalid credentials');
    }

    if (shop.status !== 'ACTIVE') {
      throw new Error('Account is not active');
    }

    const isValidPassword = await bcrypt.compare(password, shop.password);
    
    if (!isValidPassword) {
      throw new Error('Invalid credentials');
    }

    const token = this.generateToken({
      id: shop.id,
      username: shop.username,
      role: 'shop',
    });

    return {
      access_token: token,
      role: 'shop',
      user: {
        id: shop.id,
        name: shop.name,
        username: shop.username,
      },
    };
  }

  async verifyToken(token: string): Promise<JWTPayload> {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;
      return decoded;
    } catch (error) {
      throw new Error('Invalid token');
    }
  }
}
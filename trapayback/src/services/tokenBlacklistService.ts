import { config } from '../config/config';

interface BlacklistedToken {
  token: string;
  expiresAt: number;
}

export class TokenBlacklistService {
  private blacklistedTokens: Set<string> = new Set();
  private tokenExpirations: Map<string, number> = new Map();

  constructor() {
    setInterval(() => {
      this.cleanupExpiredTokens();
    }, 60 * 60 * 1000);
  }

  blacklistToken(token: string, expiresAt: number): void {
    this.blacklistedTokens.add(token);
    this.tokenExpirations.set(token, expiresAt);
  }

  isTokenBlacklisted(token: string): boolean {
    return this.blacklistedTokens.has(token);
  }

  private cleanupExpiredTokens(): void {
    const now = Math.floor(Date.now() / 1000);
    
    for (const [token, expiresAt] of this.tokenExpirations.entries()) {
      if (expiresAt <= now) {
        this.blacklistedTokens.delete(token);
        this.tokenExpirations.delete(token);
      }
    }
  }

  getStats(): { totalBlacklisted: number; activeBlacklisted: number } {
    const now = Math.floor(Date.now() / 1000);
    let activeCount = 0;

    for (const expiresAt of this.tokenExpirations.values()) {
      if (expiresAt > now) {
        activeCount++;
      }
    }

    return {
      totalBlacklisted: this.blacklistedTokens.size,
      activeBlacklisted: activeCount,
    };
  }
}

export const tokenBlacklistService = new TokenBlacklistService();
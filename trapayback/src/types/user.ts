export interface GatewaySettings {
  commission: number; // Percentage (0-100)
  payoutDelay: number; // Days
}

export interface WalletSettings {
  usdtPolygonWallet?: string | null;
  usdtTrcWallet?: string | null;
  usdtErcWallet?: string | null;
  usdcPolygonWallet?: string | null;
}

export interface CreateUserRequest {
  fullName: string;
  username: string;
  password: string;
  telegramId?: string;
  merchantUrl: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  gateways?: string[]; // List of enabled gateways
  gatewaySettings?: Record<string, GatewaySettings>; // Gateway-specific settings
  // Wallet fields
  wallets?: WalletSettings;
}

export interface UserResponse {
  id: string;
  fullName: string;
  username: string;
  telegramId?: string | null;
  merchantUrl: string;
  gateways?: string[] | null;
  gatewaySettings?: Record<string, GatewaySettings> | null;
  publicKey: string;
  // Wallet fields
  wallets?: WalletSettings;
  status: string;
  createdAt: Date;
}

export interface UpdateUserRequest extends Partial<CreateUserRequest> {
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}
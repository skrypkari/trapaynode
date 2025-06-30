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

export interface ShopProfileResponse {
  id: string;
  fullName: string;
  username: string;
  telegramId?: string | null;
  merchantUrl: string;
  gateways?: string[] | null;
  gatewaySettings?: Record<string, GatewaySettings> | null;
  publicKey: string;
  webhookUrl?: string | null;
  webhookEvents?: string[] | null;
  // Wallet fields
  wallets?: WalletSettings;
  status: string;
  createdAt: Date;
}

export interface UpdateShopProfileRequest {
  fullName?: string;
  telegramId?: string;
  merchantUrl?: string;
  gateways?: string[];
  gatewaySettings?: Record<string, GatewaySettings>;
  webhookUrl?: string;
  webhookEvents?: string[];
  // Wallet fields
  wallets?: WalletSettings;
}

export interface UpdateWalletsRequest {
  usdtPolygonWallet?: string;
  usdtTrcWallet?: string;
  usdtErcWallet?: string;
  usdcPolygonWallet?: string;
}
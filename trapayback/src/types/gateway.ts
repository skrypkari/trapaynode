// Gateway ID to name mapping
export const GATEWAY_ID_MAP: Record<string, string> = {
  '0001': 'plisio',
  '0010': 'rapyd', 
  '0100': 'cointopay',
  '1000': 'noda',
  '1001': 'klyme_eu',
  '1010': 'klyme_gb',
  '1100': 'klyme_de',
};

// Reverse mapping for name to ID
export const GATEWAY_NAME_MAP: Record<string, string> = {
  'plisio': '0001',
  'rapyd': '0010',
  'cointopay': '0100', 
  'noda': '1000',
  'klyme_eu': '1001',
  'klyme_gb': '1010',
  'klyme_de': '1100',
};

export interface GatewayInfo {
  id: string;
  name: string;
  displayName: string;
  region?: string;
  isActive: boolean;
  description?: string;
  features?: string[];
  color?: string;
  fee?: string;
  payout?: string;
}

export const AVAILABLE_GATEWAYS: GatewayInfo[] = [
  {
    id: '0001',
    name: 'plisio',
    displayName: 'Plisio',
    isActive: true,
  },
  {
    id: '0010', 
    name: 'rapyd',
    displayName: 'Rapyd',
    isActive: true,
  },
  {
    id: '0100',
    name: 'cointopay', 
    displayName: 'CoinToPay',
    isActive: true,
  },
  {
    id: '1000',
    name: 'noda',
    displayName: 'Noda',
    isActive: true,
  },
  {
    id: '1001',
    name: 'klyme_eu',
    displayName: 'KLYME EU',
    region: 'EU',
    isActive: true,
  },
  {
    id: '1010',
    name: 'klyme_gb',
    displayName: 'KLYME GB',
    region: 'GB',
    isActive: true,
  },
  {
    id: '1100',
    name: 'klyme_de',
    displayName: 'KLYME DE',
    region: 'DE',
    isActive: true,
  },
];

// ✅ ДОБАВЛЕНО: Детальная информация о шлюзах для Telegram уведомлений
export const GATEWAY_INFO: Record<string, GatewayInfo> = {
  '0001': {
    id: '0001',
    name: 'Plisio',
    displayName: '001 - Cryptocurrency (Global)',
    description: 'Modern payment infrastructure - ID: 0001',
    features: ['Crypto'],
    color: 'bg-orange-500',
    fee: '10%',
    payout: 'T+5',
    isActive: true,
  },
  '0010': {
    id: '0010',
    name: 'Rapyd',
    displayName: '0010 - Bank Card (Visa, Master, AmEx, Maestro)',
    description: 'Global payment processing - ID: 0010',
    features: ['Multi-currency'],
    color: 'bg-purple-500',
    fee: '10%',
    payout: 'T+5',
    isActive: true,
  },
  '0100': {
    id: '0100',
    name: 'CoinToPay',
    displayName: '0100 - Open Banking (EU) + SEPA',
    description: 'Digital payment solutions - ID: 0100',
    features: ['EUR', 'SEPA'],
    color: 'bg-green-500',
    fee: '10%',
    payout: 'T+5',
    isActive: true,
  },
  '1000': {
    id: '1000',
    name: 'Noda',
    displayName: '1000 - Open Banking (EU)',
    description: 'Modern payment infrastructure - ID: 1000',
    features: ['EUR', 'SEPA'],
    color: 'bg-blue-500',
    fee: '10%',
    payout: 'T+5',
    isActive: true,
  },
  '1001': {
    id: '1001',
    name: 'KLYME_EU',
    displayName: '1001 - Open Banking (EU) KL',
    description: 'Bank transfer infrastructure - ID: 1001',
    features: ['EUR', 'SEPA'],
    color: 'bg-indigo-500',
    fee: '10%',
    payout: 'T+5',
    isActive: true,
  },
  '1010': {
    id: '1010',
    name: 'KLYME_GB',
    displayName: '1010 - Open Banking (GB) KL',
    description: 'Bank transfer infrastructure - ID: 1010',
    features: ['GBP', 'SEPA', 'Faster Payments'],
    color: 'bg-cyan-500',
    fee: '10%',
    payout: 'T+5',
    isActive: true,
  },
  '1100': {
    id: '1100',
    name: 'KLYME_DE',
    displayName: '1100 - Open Banking (DE) KL',
    description: 'Bank transfer infrastructure - ID: 1100',
    features: ['EUR', 'SEPA'],
    color: 'bg-teal-500',
    fee: '10%',
    payout: 'T+5',
    isActive: true,
  }
};

// Helper functions
export function getGatewayNameById(id: string): string | null {
  return GATEWAY_ID_MAP[id] || null;
}

export function getGatewayIdByName(name: string): string | null {
  return GATEWAY_NAME_MAP[name.toLowerCase()] || null;
}

export function isValidGatewayId(id: string): boolean {
  return id in GATEWAY_ID_MAP;
}

export function isValidGatewayName(name: string): boolean {
  return name.toLowerCase() in GATEWAY_NAME_MAP;
}

export function getActiveGateways(): GatewayInfo[] {
  return AVAILABLE_GATEWAYS.filter(gateway => gateway.isActive);
}

export function getKlymeGateways(): GatewayInfo[] {
  return AVAILABLE_GATEWAYS.filter(gateway => gateway.name.startsWith('klyme_'));
}

export function getGatewayByRegion(region: string): GatewayInfo | null {
  return AVAILABLE_GATEWAYS.find(gateway => 
    gateway.name.startsWith('klyme_') && gateway.region === region.toUpperCase()
  ) || null;
}

export function getKlymeRegionFromGatewayName(gatewayName: string): 'EU' | 'GB' | 'DE' | null {
  switch (gatewayName) {
    case 'klyme_eu': return 'EU';
    case 'klyme_gb': return 'GB';
    case 'klyme_de': return 'DE';
    default: return null;
  }
}

// ✅ ДОБАВЛЕНО: Helper function to get gateway display name for Telegram
export function getGatewayDisplayNameForTelegram(gatewayName: string): string {
  // Сначала получаем ID шлюза по имени
  const gatewayId = getGatewayIdByName(gatewayName);
  
  if (gatewayId && GATEWAY_INFO[gatewayId]) {
    // Возвращаем displayName из GATEWAY_INFO
    return GATEWAY_INFO[gatewayId].displayName;
  }
  
  // Fallback: возвращаем ID или имя шлюза
  return gatewayId || gatewayName.toUpperCase();
}
export interface PayoutResponse {
  id: string;
  shopId: string;
  amount: number;
  method: string;
  status: 'PENDING' | 'COMPLETED' | 'REJECTED';
  txid?: string | null;
  createdAt: Date;
  paidAt?: Date | null;
  shop?: {
    name: string;
    username: string;
  };
}

export interface PayoutFilters {
  page: number;
  limit: number;
  status?: string;
  method?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface PayoutStatistics {
  totalPayouts: number;
  completedPayouts: number;
  pendingPayouts: number;
  rejectedPayouts: number;
  totalAmount: number;
  completedAmount: number;
  pendingAmount: number;
  payoutsByMethod: Record<string, number>;
  payoutsByStatus: Record<string, number>;
  recentPayouts: PayoutResponse[];
}

// New interface for shop payout stats
export interface ShopPayoutStats {
  availableBalance: number;    // Available balance in USDT
  totalPaidOut: number;       // Total paid out amount in USDT
  awaitingPayout: number;     // Awaiting payout amount in USDT
  thisMonth: number;          // This month payouts in USDT
}

export interface PayoutStats {
  totalBalance: number;
  totalPaidOut: number;
  awaitingPayout: number;
  thisMonth: number;
}

// New interface for shop payout list item
export interface ShopPayoutResponse {
  id: string;
  amount: number;
  network: string;
  status: string;
  txid?: string | null;
  notes?: string | null;
  createdAt: Date;
  paidAt: Date;
}
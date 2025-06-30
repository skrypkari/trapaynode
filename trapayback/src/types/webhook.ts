export interface WebhookLogResponse {
  id: string;
  paymentId: string;
  shopId: string;
  event: string;
  statusCode: number;
  retryCount: number;
  responseBody?: string | null;
  createdAt: Date;
  payment?: {
    id: string;
    amount: number;
    currency: string;
  };
}

export interface WebhookLogFilters {
  page: number;
  limit: number;
  paymentId?: string;
}
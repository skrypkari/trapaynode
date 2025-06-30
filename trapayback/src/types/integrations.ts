export interface IntegrationsResponse {
  webhook: {
    url?: string | null;
    events: string[];
  };
}

export interface UpdateWebhookSettingsRequest {
  webhookUrl?: string;
  webhookEvents?: string[];
}
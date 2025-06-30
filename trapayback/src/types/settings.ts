export interface ShopSettingsResponse {
  fullName: string;
  brand: string;
  merchantUrl: string;
  telegramUsername?: string | null;
  telegramBotApiKey?: string | null;
  telegramChatId?: string | null;
  webhookUrl?: string | null;
  webhookEvents?: string[]; // ✅ Остается string[] для API ответов
  notifications: {
    payment_success: boolean;
    payment_failed: boolean;
    refund: boolean;
    payout: boolean;
    login: boolean;
    api_error: boolean;
  };
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
}

export interface UpdateNotificationsRequest {
  payment_success?: boolean;
  payment_failed?: boolean;
  refund?: boolean;
  payout?: boolean;
  login?: boolean;
  api_error?: boolean;
}

export interface UpdateTelegramSettingsRequest {
  botApiKey?: string;
  chatId?: string;
}

export interface UpdateWebhookSettingsRequest {
  webhookUrl?: string;
  webhookEvents?: string[];
}

export interface DeleteAccountRequest {
  passwordConfirmation: string;
}
import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { GATEWAY_ID_MAP, isValidGatewayId } from '../types/gateway';

// Allowed currencies list for regular currency field
const ALLOWED_CURRENCIES = [
  "btc",
  "eth",
  "ltc",
  "bch",
  "bnb",
  "eos",
  "xrp",
  "xlm",
  "link",
  "dot",
  "yfi",
  "usd",
  "aed",
  "ars",
  "aud",
  "bdt",
  "bhd",
  "bmd",
  "brl",
  "cad",
  "chf",
  "clp",
  "cny",
  "czk",
  "dkk",
  "eur",
  "gbp",
  "gel",
  "hkd",
  "huf",
  "idr",
  "ils",
  "inr",
  "jpy",
  "krw",
  "kwd",
  "lkr",
  "mmk",
  "mxn",
  "myr",
  "ngn",
  "nok",
  "nzd",
  "php",
  "pkr",
  "pln",
  "rub",
  "sar",
  "sek",
  "sgd",
  "thb",
  "try",
  "twd",
  "uah",
  "vef",
  "vnd",
  "zar",
  "xdr",
  "xag",
  "xau",
  "bits",
  "sats"
];

// Allowed source currencies for Plisio (crypto only)
const ALLOWED_SOURCE_CURRENCIES = [
  "eth",        // ETH - Ethereum
  "btc",        // BTC - Bitcoin
  "ltc",        // LTC - Litecoin
  "dash",       // DASH - Dash
  "tzec",       // TZEC - Zcash (Plisio uses TZEC for ZEC)
  "doge",       // DOGE - Dogecoin
  "bch",        // BCH - Bitcoin Cash
  "xmr",        // XMR - Monero
  "usdt",       // USDT - Tether ERC-20
  "usdc",       // USDC - USD Coin
  "shib",       // SHIB - Shiba Inu
  "ape",        // APE - ApeCoin
  "btt",        // BTT - BitTorrent TRC-20
  "usdt_trx",   // USDT_TRX - Tether TRC-20
  "trx",        // TRX - Tron
  "bnb",        // BNB - BNB Chain
  "busd",       // BUSD - Binance USD BEP-20
  "usdt_bsc",   // USDT_BSC - Tether BEP-20
  "usdc_bsc",   // USDC_BSC - USDC BEP-20
  "lb",         // LB - LoveBit BEP-20
  "etc",        // ETC - Ethereum Classic
  "ton",        // TON - Toncoin
  "usdt_ton",   // USDT_TON - Tether TON
  "sol",        // SOL - Solana
  "usdt_sol"    // USDT_SOL - Tether Solana
];

// Allowed payment gateway IDs
const ALLOWED_GATEWAY_IDS = Object.keys(GATEWAY_ID_MAP);

// Allowed payment gateways (for admin/internal use)
const ALLOWED_GATEWAYS = ['Plisio', 'Rapyd', 'Noda', 'CoinToPay', 'KLYME EU', 'KLYME GB', 'KLYME DE'];

// Allowed networks for payouts
const ALLOWED_NETWORKS = ['polygon', 'trc20', 'erc20', 'bsc'];

// Custom validator for gateway ID
const gatewayIdValidator = Joi.string().custom((value, helpers) => {
  if (!isValidGatewayId(value)) {
    return helpers.error('any.invalid', { 
      message: `Gateway ID must be one of: ${ALLOWED_GATEWAY_IDS.join(', ')}` 
    });
  }
  return value;
});

// Gateway settings validation schema
const gatewaySettingsSchema = Joi.object({
  commission: Joi.number().min(0).max(100).required(),
  payoutDelay: Joi.number().integer().min(0).max(365).required(),
});

// Wallet settings validation schema
const walletSettingsSchema = Joi.object({
  usdtPolygonWallet: Joi.string().min(1).max(200).optional().allow(''),
  usdtTrcWallet: Joi.string().min(1).max(200).optional().allow(''),
  usdtErcWallet: Joi.string().min(1).max(200).optional().allow(''),
  usdcPolygonWallet: Joi.string().min(1).max(200).optional().allow(''),
});

export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        details: error.details.map(detail => detail.message),
      });
    }
    
    next();
  };
};

export const loginSchema = Joi.object({
  username: Joi.string().min(3).max(50).required(),
  password: Joi.string().min(3).max(100).required(),
});

export const createUserSchema = Joi.object({
  fullName: Joi.string().min(2).max(100).required(),
  username: Joi.string().min(3).max(50).required(),
  password: Joi.string().min(6).max(100).required(),
  telegramId: Joi.string().min(3).max(50).optional().allow(''),
  merchantUrl: Joi.string().uri().required(),
  gateways: Joi.array().items(Joi.string().valid(...ALLOWED_GATEWAYS)).optional(),
  gatewaySettings: Joi.object().pattern(
    Joi.string().valid(...ALLOWED_GATEWAYS),
    gatewaySettingsSchema
  ).optional(),
  wallets: walletSettingsSchema.optional(),
});

export const updateUserSchema = Joi.object({
  fullName: Joi.string().min(2).max(100).optional(),
  username: Joi.string().min(3).max(50).optional(),
  password: Joi.string().min(6).max(100).optional(),
  telegramId: Joi.string().min(3).max(50).optional().allow(''),
  merchantUrl: Joi.string().uri().optional(),
  gateways: Joi.array().items(Joi.string().valid(...ALLOWED_GATEWAYS)).optional(),
  gatewaySettings: Joi.object().pattern(
    Joi.string().valid(...ALLOWED_GATEWAYS),
    gatewaySettingsSchema
  ).optional(),
  wallets: walletSettingsSchema.optional(),
  status: Joi.string().valid('ACTIVE', 'INACTIVE', 'SUSPENDED').optional(),
});

// Shop profile validation schemas
export const updateShopProfileSchema = Joi.object({
  fullName: Joi.string().min(2).max(100).optional(),
  telegramId: Joi.string().min(3).max(50).optional().allow(''),
  merchantUrl: Joi.string().uri().optional(),
  gateways: Joi.array().items(Joi.string().valid(...ALLOWED_GATEWAYS)).optional(),
  gatewaySettings: Joi.object().pattern(
    Joi.string().valid(...ALLOWED_GATEWAYS),
    gatewaySettingsSchema
  ).optional(),
  wallets: walletSettingsSchema.optional(),
});

// Wallets validation schema
export const updateWalletsSchema = Joi.object({
  usdtPolygonWallet: Joi.string().min(1).max(200).optional().allow(''),
  usdtTrcWallet: Joi.string().min(1).max(200).optional().allow(''),
  usdtErcWallet: Joi.string().min(1).max(200).optional().allow(''),
  usdcPolygonWallet: Joi.string().min(1).max(200).optional().allow(''),
});

// Payment validation schemas - Updated to use gateway IDs
export const createPaymentSchema = Joi.object({
  gateway: gatewayIdValidator.required(), // Now accepts gateway ID instead of name
  amount: Joi.number().positive().required(),
  currency: Joi.string().valid(...ALLOWED_CURRENCIES).insensitive().optional().default('USD'),
  sourceCurrency: Joi.string().valid(...ALLOWED_SOURCE_CURRENCIES).insensitive().optional(), // Updated with crypto-only list
  usage: Joi.string().valid('ONCE', 'REUSABLE').optional().default('ONCE'),
  expiresAt: Joi.date().iso().greater('now').optional(),
  redirectUrl: Joi.string().uri().required(),
  customerEmail: Joi.string().email().optional(),
  customerName: Joi.string().min(1).max(100).optional(),
  // New Rapyd fields
  country: Joi.string().length(2).uppercase().optional(),
  language: Joi.string().length(2).uppercase().optional(),
  amountIsEditable: Joi.boolean().optional(),
  maxPayments: Joi.number().integer().min(1).optional(),
  customer: Joi.string().pattern(/^cus_/).optional(), // Rapyd customer ID starts with 'cus_'
});

export const createPublicPaymentSchema = Joi.object({
  public_key: Joi.string().min(1).max(100).required(),
  gateway: gatewayIdValidator.required(), // Now accepts gateway ID instead of name
  order_id: Joi.string().min(1).max(100).optional(), // Made optional since we auto-generate if not provided
  amount: Joi.number().positive().required(),
  currency: Joi.string().valid(...ALLOWED_CURRENCIES).insensitive().optional().default('USD'),
  source_currency: Joi.string().valid(...ALLOWED_SOURCE_CURRENCIES).insensitive().optional(), // Updated with crypto-only list
  usage: Joi.string().valid('ONCE', 'REUSABLE').optional().default('ONCE'),
  expires_at: Joi.date().iso().greater('now').optional(),
  success_url: Joi.string().uri().optional(),
  fail_url: Joi.string().uri().optional(),
  customer_email: Joi.string().email().optional(),
  customer_name: Joi.string().min(1).max(100).optional(),
  // New Rapyd fields
  country: Joi.string().length(2).uppercase().optional(),
  language: Joi.string().length(2).uppercase().optional(),
  amount_is_editable: Joi.boolean().optional(),
  max_payments: Joi.number().integer().min(1).optional(),
  customer: Joi.string().pattern(/^cus_/).optional(), // Rapyd customer ID starts with 'cus_'
});

export const updatePaymentSchema = Joi.object({
  gateway: gatewayIdValidator.optional(), // Now accepts gateway ID instead of name
  amount: Joi.number().positive().optional(),
  currency: Joi.string().valid(...ALLOWED_CURRENCIES).insensitive().optional(),
  sourceCurrency: Joi.string().valid(...ALLOWED_SOURCE_CURRENCIES).insensitive().optional(), // Updated with crypto-only list
  usage: Joi.string().valid('ONCE', 'REUSABLE').optional(),
  expiresAt: Joi.date().iso().greater('now').optional().allow(null),
  redirectUrl: Joi.string().uri().optional(),
  status: Joi.string().valid('PENDING', 'PROCESSING', 'PAID', 'EXPIRED', 'FAILED', 'REFUND', 'CHARGEBACK').optional(), // ✅ ДОБАВЛЕНО: PROCESSING статус
  externalPaymentUrl: Joi.string().uri().optional().allow(''),
  customerEmail: Joi.string().email().optional(),
  customerName: Joi.string().min(1).max(100).optional(),
  // New Rapyd fields
  country: Joi.string().length(2).uppercase().optional(),
  language: Joi.string().length(2).uppercase().optional(),
  amountIsEditable: Joi.boolean().optional(),
  maxPayments: Joi.number().integer().min(1).optional(),
  customer: Joi.string().pattern(/^cus_/).optional(),
});

// ✅ ОБНОВЛЕНО: Admin payment update schema с поддержкой PROCESSING статуса
export const updatePaymentStatusSchema = Joi.object({
  status: Joi.string().valid('PENDING', 'PROCESSING', 'PAID', 'EXPIRED', 'FAILED', 'REFUND', 'CHARGEBACK').required(), // ✅ ДОБАВЛЕНО: PROCESSING
  notes: Joi.string().max(500).optional(),
  chargebackAmount: Joi.when('status', {
    is: 'CHARGEBACK',
    then: Joi.number().positive().required().messages({
      'number.positive': 'Chargeback amount must be positive',
      'any.required': 'Chargeback amount is required for CHARGEBACK status (amount in USDT)',
    }),
    otherwise: Joi.forbidden().messages({
      'any.unknown': 'Chargeback amount is only allowed for CHARGEBACK status',
    }),
  }),
});

// Payout validation schemas
export const createPayoutSchema = Joi.object({
  shopId: Joi.string().min(1).max(100).required(),
  amount: Joi.number().positive().required(),
  network: Joi.string().valid(...ALLOWED_NETWORKS).required(),
  notes: Joi.string().max(500).optional(),
});

// Payment Link validation schemas
export const createPaymentLinkSchema = Joi.object({
  amount: Joi.number().positive().required(),
  currency: Joi.string().valid(...ALLOWED_CURRENCIES).insensitive().optional().default('USD'),
  sourceCurrency: Joi.string().valid(...ALLOWED_SOURCE_CURRENCIES).insensitive().optional(), // For Plisio
  gateway: gatewayIdValidator.required(), // Gateway ID
  maxPayments: Joi.number().integer().min(1).max(1000).optional().default(1),
  expiresAt: Joi.date().iso().greater('now').optional(),
  successUrl: Joi.string().uri().optional(),
  failUrl: Joi.string().uri().optional(),
  // Rapyd specific fields
  country: Joi.string().length(2).uppercase().optional(),
  language: Joi.string().length(2).uppercase().optional().default('EN'),
});

export const updatePaymentLinkSchema = Joi.object({
  amount: Joi.number().positive().optional(),
  currency: Joi.string().valid(...ALLOWED_CURRENCIES).insensitive().optional(),
  sourceCurrency: Joi.string().valid(...ALLOWED_SOURCE_CURRENCIES).insensitive().optional(),
  gateway: gatewayIdValidator.optional(),
  maxPayments: Joi.number().integer().min(1).max(1000).optional(),
  expiresAt: Joi.date().iso().greater('now').optional().allow(null),
  successUrl: Joi.string().uri().optional().allow(''),
  failUrl: Joi.string().uri().optional().allow(''),
  // Rapyd specific fields
  country: Joi.string().length(2).uppercase().optional(),
  language: Joi.string().length(2).uppercase().optional(),
  status: Joi.string().valid('ACTIVE', 'INACTIVE', 'EXPIRED', 'COMPLETED').optional(),
});

// Schema for initiating payment from link
export const initiatePaymentFromLinkSchema = Joi.object({
  customerEmail: Joi.string().email().optional(),
  customerName: Joi.string().min(1).max(100).optional(),
});

// Settings validation schemas
export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().min(1).max(100).required(),
  newPassword: Joi.string().min(6).max(100).required(),
  confirmNewPassword: Joi.string().min(6).max(100).required(),
});

export const updateNotificationsSchema = Joi.object({
  payment_success: Joi.boolean().optional(),
  payment_failed: Joi.boolean().optional(),
  refund: Joi.boolean().optional(),
  payout: Joi.boolean().optional(),
  login: Joi.boolean().optional(),
  api_error: Joi.boolean().optional(),
});

export const updateTelegramSettingsSchema = Joi.object({
  botApiKey: Joi.string().min(1).max(200).optional().allow(''),
  chatId: Joi.string().min(1).max(100).optional().allow(''),
});

export const updateWebhookSettingsSchema = Joi.object({
  webhookUrl: Joi.string().uri().optional().allow(''),
  webhookEvents: Joi.array().items(
    Joi.string().valid('payment.success', 'payment.failed', 'payment.pending')
  ).optional(),
});

export const deleteAccountSchema = Joi.object({
  passwordConfirmation: Joi.string().min(1).max(100).required(),
});
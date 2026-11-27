import crypto from 'node:crypto';
import type { ServerSecrets } from './types';

export class HttpError extends Error {
  readonly statusCode: number;
  readonly skipReason?: string;

  constructor(statusCode: number, message: string, skipReason?: string) {
    super(message);
    this.statusCode = statusCode;
    this.skipReason = skipReason;
  }
}

export const isProduction =
  process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);

export const simulationRoutesEnabled =
  (!isProduction && !process.env.K_SERVICE) ||
  process.env.ENABLE_SIMULATION_ROUTES === 'true';

const DEV_FALLBACK_OTP_PEPPER = 'payreminder-dev-otp-pepper-local-only';

export function getServerSecrets(): ServerSecrets {
  return {
    whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    whatsappWebhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
    whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || '',
    smsProviderUrl: process.env.SMS_PROVIDER_URL || '',
    smsApiKey: process.env.SMS_API_KEY || '',
    smsSenderId: process.env.SMS_SENDER_ID || 'PayReminder',
    paymentProviderUrl: process.env.PAYMENT_PROVIDER_URL || '',
    paymentApiKey: process.env.PAYMENT_API_KEY || '',
    paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
    emailProviderApiKey: process.env.EMAIL_PROVIDER_API_KEY || '',
    emailFromAddress: process.env.EMAIL_FROM_ADDRESS || 'rapports@payreminder.cm',
    cronSecret: process.env.CRON_SECRET || '',
    otpPepper: process.env.OTP_PEPPER || '',
    allowedPhonePrefixes: process.env.ALLOWED_PHONE_PREFIXES || '+237',
    allowPlanChangeWithoutPayment: process.env.ALLOW_PLAN_CHANGE_WITHOUT_PAYMENT === 'true',
    appBaseUrl: process.env.APP_URL || 'http://localhost:3000',
  };
}

export function resolveOtpPepper(secrets: ServerSecrets, prod = isProduction): string {
  const clean = (secrets.otpPepper || '').trim();
  if (clean) {
    return clean;
  }
  if (prod) {
    throw new HttpError(503, 'OTP_PEPPER non configuré sur le serveur.', 'otp_pepper_missing');
  }
  return DEV_FALLBACK_OTP_PEPPER;
}

export function resolveTrustProxyHops(
  prod = isProduction,
  rawValue: string | number | undefined = process.env.TRUST_PROXY_HOPS
): number {
  const fallback = prod ? 1 : 0;
  if (rawValue === undefined || rawValue === null) {
    return fallback;
  }
  if (typeof rawValue === 'number') {
    return Number.isInteger(rawValue) && rawValue >= 0 ? rawValue : fallback;
  }
  const trimmed = rawValue.trim();
  if (!trimmed || !/^[0-9]+$/.test(trimmed)) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function hmacPhoneNumber(pepper: string, phoneE164: string): string {
  return crypto.createHmac('sha256', pepper).update(phoneE164.trim()).digest('hex');
}

export function hmacPhoneCode(pepper: string, salt: string, code: string): string {
  return crypto.createHmac('sha256', pepper).update(`${salt}:${code}`).digest('hex');
}

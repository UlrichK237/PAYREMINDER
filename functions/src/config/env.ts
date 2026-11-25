/**
 * Centralisation des variables d'environnement et secrets Cloud Functions.
 * AUCUNE clé ne doit être présente côté client (src/).
 *
 * Emplacement des secrets en production :
 *  - `firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN` (ou fichier `functions/.env`)
 *  - `SMS_API_KEY`, `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET`, `EMAIL_PROVIDER_API_KEY`
 */
export interface ServerSecretsConfig {
  whatsappAccessToken: string;
  whatsappPhoneNumberId: string;
  whatsappWebhookVerifyToken: string;
  smsProviderUrl: string;
  smsApiKey: string;
  smsSenderId: string;
  paymentProviderUrl: string;
  paymentApiKey: string;
  paymentWebhookSecret: string;
  emailProviderApiKey: string;
  emailFromAddress: string;
  appBaseUrl: string;
}

export function loadSecretsConfig(): ServerSecretsConfig {
  return {
    whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    whatsappWebhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'payreminder_verify_token',
    smsProviderUrl: process.env.SMS_PROVIDER_URL || '',
    smsApiKey: process.env.SMS_API_KEY || '',
    smsSenderId: process.env.SMS_SENDER_ID || 'PayReminder',
    paymentProviderUrl: process.env.PAYMENT_PROVIDER_URL || '',
    paymentApiKey: process.env.PAYMENT_API_KEY || '',
    paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
    emailProviderApiKey: process.env.EMAIL_PROVIDER_API_KEY || '',
    emailFromAddress: process.env.EMAIL_FROM_ADDRESS || 'rapports@payreminder.cm',
    appBaseUrl: process.env.APP_URL || 'https://payreminder.cm',
  };
}

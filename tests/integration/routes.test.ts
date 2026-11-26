import crypto from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import type { DecodedAuthToken, ServerSecrets } from '../../server/types';
import { InMemoryFirestore } from '../helpers/inMemoryFirestore';

const TEST_TOKENS: Record<string, DecodedAuthToken> = {
  token_owner_a: { uid: 'owner_A', email: 'ownerA@etoile.cm', email_verified: true },
  token_staff_a: { uid: 'staff_A', email: 'staffA@etoile.cm', email_verified: true },
  token_owner_b: { uid: 'owner_B', email: 'ownerB@b.cm', email_verified: true },
  token_owner_c: { uid: 'owner_C', email: 'ownerC@c.cm', email_verified: true },
  token_unverified: { uid: 'owner_A', email: 'ownerA@etoile.cm', email_verified: false },
};

function makeSecrets(overrides: Partial<ServerSecrets> = {}): ServerSecrets {
  return {
    whatsappAccessToken: '',
    whatsappPhoneNumberId: '',
    whatsappWebhookVerifyToken: 'wa_verify_test',
    whatsappAppSecret: 'wa_secret_test',
    smsProviderUrl: '',
    smsApiKey: '',
    smsSenderId: 'PayReminder',
    paymentProviderUrl: '',
    paymentApiKey: '',
    paymentWebhookSecret: 'pay_secret_test',
    emailProviderApiKey: '',
    emailFromAddress: 'no-reply@payreminder.cm',
    cronSecret: 'cron_secret_test_12345',
    otpPepper: 'test_otp_pepper_secret_32_bytes_ok',
    allowedPhonePrefixes: '+237',
    allowPlanChangeWithoutPayment: false,
    appBaseUrl: 'http://localhost:3000',
    ...overrides,
  };
}

function signBody(body: Record<string, unknown>, secret: string): string {
  const hex = crypto.createHmac('sha256', secret).update(JSON.stringify(body), 'utf8').digest('hex');
  return `sha256=${hex}`;
}

function setupHarness(options?: {
  nowMs?: number;
  secrets?: Partial<ServerSecrets>;
  isProduction?: boolean;
  simulationRoutesEnabled?: boolean;
  smsShouldFail?: boolean;
  smsShouldThrow?: boolean;
  cronTimeBudgetMs?: number;
  cronMaxConcurrency?: number;
  onSmsSend?: () => void;
}) {
  let currentNow = options?.nowMs ?? Date.parse('2026-11-25T10:00:00.000Z'); // 11h00 Douala
  const db = new InMemoryFirestore(() => currentNow);

  db.seed('tenants/tenant_A', {
    name: 'Boutique Étoile',
    sector: 'Commerce',
    phone: '+237677112233',
    email: 'ownerA@etoile.cm',
    plan: 'starter',
    maxDebtors: 50,
    maxRemindersPerMonth: 200,
    maxRemindersPerDay: 40,
    remindersUsedThisMonth: 0,
    quotaResetMonth: '2026-11',
    quietHoursStart: 20,
    quietHoursEnd: 7,
    autoEscalate: false,
    fallbackToSms: true,
    ownerId: 'owner_A',
  });
  db.seed('tenants/tenant_A/users/owner_A', {
    tenantId: 'tenant_A',
    uid: 'owner_A',
    role: 'owner',
    name: 'Propriétaire A',
    email: 'ownerA@etoile.cm',
    status: 'active',
  });
  db.seed('tenants/tenant_A/users/staff_A', {
    tenantId: 'tenant_A',
    uid: 'staff_A',
    role: 'staff',
    name: 'Caissier A',
    email: 'staffA@etoile.cm',
    status: 'active',
  });
  db.seed('tenants/tenant_A/debtors/deb_1', {
    tenantId: 'tenant_A',
    name: 'Jean Fotso',
    phone: '+237677123456',
    preferredChannel: 'sms',
    optOut: false,
    reliabilityScore: 80,
  });
  db.seed('tenants/tenant_A/debts/debt_1', {
    tenantId: 'tenant_A',
    debtorId: 'deb_1',
    debtorName: 'Jean Fotso',
    debtorPhone: '+237677123456',
    initialAmount: 20000,
    remainingAmount: 20000,
    issuedAt: '2026-11-10',
    dueDate: '2026-11-25',
    status: 'en_cours',
    description: 'Facture #104',
    reminderCount: 0,
  });
  db.seed('tenants/tenant_A/reminderRules/rule_0', {
    tenantId: 'tenant_A',
    offsetDays: 0,
    label: 'Jour J',
    channel: 'sms',
    tone: 'amical',
    allowedStartHour: 8,
    allowedEndHour: 19,
    maxReminders: 4,
    enabled: true,
  });

  db.seed('tenants/tenant_B', {
    name: 'Autre Boutique',
    phone: '+237699000111',
    email: 'ownerB@b.cm',
    plan: 'free',
    ownerId: 'owner_B',
  });
  db.seed('tenants/tenant_B/users/owner_B', {
    tenantId: 'tenant_B',
    uid: 'owner_B',
    role: 'owner',
    name: 'Propriétaire B',
    email: 'ownerB@b.cm',
    status: 'active',
  });

  const secrets = makeSecrets(options?.secrets);
  const app = createApp({
    verifyIdToken: async (token) => {
      const match = TEST_TOKENS[token];
      if (!match) throw new Error('Invalid token');
      return match;
    },
    db,
    fieldValue: db.fieldValue,
    now: () => currentNow,
    getSecrets: () => secrets,
    isProduction: options?.isProduction ?? false,
    simulationRoutesEnabled: options?.simulationRoutesEnabled ?? true,
    cronTimeBudgetMs: options?.cronTimeBudgetMs,
    cronMaxConcurrency: options?.cronMaxConcurrency,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    providers: {
      createSmsProvider: () => ({
        name: 'test-sms',
        sendSms: async () => {
          options?.onSmsSend?.();
          if (options?.smsShouldThrow) {
            throw new Error('SMS gateway timeout');
          }
          if (options?.smsShouldFail) {
            return {
              success: false,
              simulated: false,
              providerMessageId: 'sms_fail_1',
              status: 'echouee',
              errorMessage: 'Provider error',
            };
          }
          return {
            success: true,
            simulated: true,
            providerMessageId: `sms_ok_${currentNow}`,
            status: 'simule',
          };
        },
      }),
    },
  });

  return {
    app,
    db,
    secrets,
    advanceMs: (ms: number) => {
      currentNow += ms;
    },
  };
}

describe('Routes Express PayReminder (Supertest)', () => {
  it('rejette 401 sans jeton, jeton invalide ou email non vérifié', async () => {
    const { app } = setupHarness();

    await request(app).post('/api/reminders/dispatch').send({ tenantId: 'tenant_A', debtId: 'debt_1' }).expect(401);
    await request(app)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer bad_token')
      .send({ tenantId: 'tenant_A', debtId: 'debt_1' })
      .expect(401);
    await request(app)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer token_unverified')
      .send({ tenantId: 'tenant_A', debtId: 'debt_1' })
      .expect(401);
  });

  it('rejette 403 cross-tenant et routes owner-only pour un staff', async () => {
    const { app } = setupHarness();

    await request(app)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer token_owner_b')
      .send({ tenantId: 'tenant_A', debtId: 'debt_1' })
      .expect(403);

    await request(app)
      .post('/api/billing/checkout')
      .set('Authorization', 'Bearer token_staff_a')
      .send({ tenantId: 'tenant_A', planId: 'pro' })
      .expect(403);

    await request(app)
      .post('/api/debtors/erase')
      .set('Authorization', 'Bearer token_staff_a')
      .send({ tenantId: 'tenant_A', debtorId: 'deb_1' })
      .expect(403);
  });

  it('applique le délai 24h (409) et écrit un audit log sur relance manuelle', async () => {
    const { app, db } = setupHarness();

    const first = await request(app)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', debtId: 'debt_1' })
      .expect(200);

    expect(first.body.ok).toBe(true);
    expect(first.body.renderedContent).toContain('Répondez STOP');
    expect(db.getRaw('tenants/tenant_A')?.remindersUsedThisMonth).toBe(1);

    await request(app)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', debtId: 'debt_1' })
      .expect(409);

    const audits = await db.collection('tenants/tenant_A/auditLogs').get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0].data()?.action).toBe('manual_reminder');
  });

  it('renvoie 429 si quota mensuel ou journalier atteint', async () => {
    const { app, db } = setupHarness();
    await db.doc('tenants/tenant_A').update({ remindersUsedThisMonth: 200 });

    await request(app)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', debtId: 'debt_1' })
      .expect(429);

    await db.doc('tenants/tenant_A').update({ remindersUsedThisMonth: 0 });
    db.seed('tenantSecurity/tenant_A', {
      dailyUsage: { date: '2026-11-25', count: 40 },
    });

    await request(app)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', debtId: 'debt_1' })
      .expect(429);
  });

  it('rembourse les quotas mensuel et journalier en cas d’échec ou exception du fournisseur SMS', async () => {
    const { app: appFail, db: dbFail } = setupHarness({ smsShouldFail: true });
    await request(appFail)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', debtId: 'debt_1' })
      .expect(502);

    expect(dbFail.getRaw('tenants/tenant_A')?.remindersUsedThisMonth).toBe(0);
    expect((dbFail.getRaw('tenantSecurity/tenant_A')?.dailyUsage as { count?: number })?.count).toBe(0);

    const { app: appThrow, db: dbThrow } = setupHarness({ smsShouldThrow: true });
    await request(appThrow)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', debtId: 'debt_1' })
      .expect(500);

    expect(dbThrow.getRaw('tenants/tenant_A')?.remindersUsedThisMonth).toBe(0);
    expect((dbThrow.getRaw('tenantSecurity/tenant_A')?.dailyUsage as { count?: number })?.count).toBe(0);
  });

  it('traite le webhook paiement avec HMAC, paiement partiel->complet, idempotence et rejet metadata subscription', async () => {
    const { app, db, secrets } = setupHarness({ isProduction: true });

    await request(app)
      .post('/api/webhooks/payment')
      .send({ tenantId: 'tenant_A', debtId: 'debt_1', amount: 5000, transactionRef: 'TX-BAD-SIG' })
      .expect(401);

    const wrongTypeBody = {
      tenantId: 'tenant_A',
      debtId: 'debt_1',
      amount: 5000,
      transactionRef: 'TX-SUB-TYPE',
      metadata: { type: 'subscription' },
    };
    await request(app)
      .post('/api/webhooks/payment')
      .set('x-payment-signature', signBody(wrongTypeBody, secrets.paymentWebhookSecret))
      .send(wrongTypeBody)
      .expect(400);

    const partialBody = {
      tenantId: 'tenant_A',
      debtId: 'debt_1',
      amount: 5000,
      method: 'mtn_momo',
      transactionRef: 'TX-PART-1',
    };
    const partialRes = await request(app)
      .post('/api/webhooks/payment')
      .set('x-payment-signature', signBody(partialBody, secrets.paymentWebhookSecret))
      .send(partialBody)
      .expect(200);
    expect(partialRes.body.remainingAmount).toBe(15000);
    expect(partialRes.body.status).toBe('partiellement_payee');

    const fullBody = {
      tenantId: 'tenant_A',
      debtId: 'debt_1',
      amount: 15000,
      method: 'orange_money',
      transactionRef: 'TX-FULL-2',
    };
    const fullRes = await request(app)
      .post('/api/webhooks/payment')
      .set('x-payment-signature', signBody(fullBody, secrets.paymentWebhookSecret))
      .send(fullBody)
      .expect(200);
    expect(fullRes.body.remainingAmount).toBe(0);
    expect(fullRes.body.status).toBe('payee');

    // Rejeu idempotent de TX-FULL-2
    const replayRes = await request(app)
      .post('/api/webhooks/payment')
      .set('x-payment-signature', signBody(fullBody, secrets.paymentWebhookSecret))
      .send(fullBody)
      .expect(200);
    expect(replayRes.body.idempotent).toBe(true);
    expect(db.getRaw('tenants/tenant_A/debts/debt_1')?.remainingAmount).toBe(0);
  });

  it('gère checkout abonnement -> webhook montant exact vs montant erroné', async () => {
    const { app, db, secrets } = setupHarness({ isProduction: true });

    const checkoutRes = await request(app)
      .post('/api/billing/checkout')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', planId: 'pro' })
      .expect(200);

    const { paymentRef } = checkoutRes.body as { paymentRef: string };

    // Montant erroné : logue une anomalie et NE change PAS le forfait
    const badAmountBody = {
      tenantId: 'tenant_A',
      paymentRef,
      amount: 1000,
      method: 'mtn_momo',
      transactionRef: 'TX-ABO-BAD',
    };
    const badRes = await request(app)
      .post('/api/webhooks/subscription-payment')
      .set('x-payment-signature', signBody(badAmountBody, secrets.paymentWebhookSecret))
      .send(badAmountBody)
      .expect(200);
    expect(badRes.body.ok).toBe(false);
    expect(badRes.body.amountMismatch).toBe(true);
    expect(db.getRaw('tenants/tenant_A')?.plan).toBe('starter');

    const anomalies = await db.collection('tenants/tenant_A/paymentAnomalies').get();
    expect(anomalies.size).toBe(1);

    // Montant exact : active le forfait Pro + planExpiresAt + audit log
    const goodAmountBody = {
      tenantId: 'tenant_A',
      paymentRef,
      amount: 15000,
      method: 'mtn_momo',
      transactionRef: 'TX-ABO-OK',
    };
    const goodRes = await request(app)
      .post('/api/webhooks/subscription-payment')
      .set('x-payment-signature', signBody(goodAmountBody, secrets.paymentWebhookSecret))
      .send(goodAmountBody)
      .expect(200);
    expect(goodRes.body.ok).toBe(true);
    expect(goodRes.body.planId).toBe('pro');
    expect(db.getRaw('tenants/tenant_A')?.plan).toBe('pro');
    expect(typeof db.getRaw('tenants/tenant_A')?.planExpiresAt).toBe('string');

    const audits = await db.collection('tenants/tenant_A/auditLogs').get();
    expect(audits.docs.some((d) => d.data()?.action === 'subscription_payment')).toBe(true);
  });

  it('désactive /api/billing/change-plan en production et /api/simulate/* quand simulationRoutesEnabled=false', async () => {
    const { app } = setupHarness({ isProduction: true, simulationRoutesEnabled: false });

    await request(app)
      .post('/api/billing/change-plan')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', planId: 'pro' })
      .expect(404);

    await request(app)
      .post('/api/simulate/payment')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', debtId: 'debt_1', amount: 5000 })
      .expect(404);

    await request(app)
      .post('/api/simulate/whatsapp-inbound')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', fromPhone: '+237677123456', messageText: 'STOP' })
      .expect(404);
  });

  it('protège les routes cron par CRON_SECRET (503 si vide, 401 si invalide) et évite les doublons par créneau 15 min', async () => {
    const { app: noSecretApp } = setupHarness({ secrets: { cronSecret: '' } });
    await request(noSecretApp).post('/api/cron/run-reminders').expect(503);
    await request(noSecretApp).post('/api/cron/subscriptions').expect(503);
    await request(noSecretApp).post('/api/reports/send-monthly').expect(503);

    const { app, secrets } = setupHarness();
    await request(app).post('/api/cron/run-reminders').set('x-cron-secret', 'wrong').expect(401);

    const run1 = await request(app)
      .post('/api/cron/run-reminders')
      .set('x-cron-secret', secrets.cronSecret)
      .expect(200);
    expect(run1.body.ok).toBe(true);
    expect(run1.body.sent).toBe(1);

    // Même créneau 15 minutes => verrouillé
    const run2 = await request(app)
      .post('/api/cron/run-reminders')
      .set('x-cron-secret', secrets.cronSecret)
      .expect(200);
    expect(run2.body.skipped).toBe(true);
  });

  it('efface complètement un débiteur, ses dettes, paiements, relances, logs et trace dans auditLogs', async () => {
    const { app, db } = setupHarness();
    db.seed('tenants/tenant_A/payments/pay_1', { tenantId: 'tenant_A', debtorId: 'deb_1', amount: 1000 });
    db.seed('tenants/tenant_A/reminders/rem_1', { tenantId: 'tenant_A', debtorId: 'deb_1' });
    db.seed('tenants/tenant_A/messageLogs/log_1', { tenantId: 'tenant_A', debtorId: 'deb_1' });

    const res = await request(app)
      .post('/api/debtors/erase')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', debtorId: 'deb_1' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.deletedDebtor).toBe(1);
    expect(res.body.deletedDebts).toBe(1);
    expect(res.body.deletedPayments).toBe(1);
    expect(res.body.deletedReminders).toBe(1);
    expect(res.body.deletedMessageLogs).toBe(1);

    expect(db.getRaw('tenants/tenant_A/debtors/deb_1')).toBeUndefined();
    expect(db.getRaw('tenants/tenant_A/debts/debt_1')).toBeUndefined();
    expect(db.getRaw('tenants/tenant_A/payments/pay_1')).toBeUndefined();
    expect(db.getRaw('tenants/tenant_A/reminders/rem_1')).toBeUndefined();
    expect(db.getRaw('tenants/tenant_A/messageLogs/log_1')).toBeUndefined();

    const audits = await db.collection('tenants/tenant_A/auditLogs').get();
    expect(audits.docs.some((d) => d.data()?.action === 'debtor_erase' && d.data()?.targetId === 'deb_1')).toBe(true);
  });

  // ==========================================================================
  // D1 : Confidentialité OTP, migration, phoneVerifiedNumber & anti SMS-pumping
  // ==========================================================================
  it('D1 : isole les secrets OTP dans tenantSecurityPrivate, migre les anciens champs, vérifie phoneVerifiedNumber et bloque sans OTP_PEPPER en prod', async () => {
    const { app, db } = setupHarness({
      secrets: {
        smsProviderUrl: 'https://sms.example.cm/send',
        smsApiKey: 'real-sms-key',
      },
    });

    // Anciens champs sensibles présents sur tenantSecurity avant migration
    db.seed('tenantSecurity/tenant_A', {
      phoneHash: 'legacy_hash',
      phoneSalt: 'legacy_salt',
      phoneCodeExpiresAt: '2026-11-25T10:10:00Z',
      phoneVerifyAttempts: 1,
      phoneTarget: '+237677112233',
      dailyUsage: { date: '2026-11-25', count: 0 },
    });

    const sendRes = await request(app)
      .post('/api/security/send-phone-code')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A' })
      .expect(200);

    expect(sendRes.body.devCode).toMatch(/^[0-9]{6}$/);

    // Vérifie l'absence totale des champs OTP sur tenantSecurity et leur présence dans tenantSecurityPrivate
    const pubAfterSend = db.getRaw('tenantSecurity/tenant_A')!;
    expect(pubAfterSend.phoneHash).toBeUndefined();
    expect(pubAfterSend.phoneSalt).toBeUndefined();
    expect(pubAfterSend.phoneCodeExpiresAt).toBeUndefined();
    expect(pubAfterSend.phoneVerifyAttempts).toBeUndefined();
    expect(pubAfterSend.phoneTarget).toBeUndefined();

    const privAfterSend = db.getRaw('tenantSecurityPrivate/tenant_A')!;
    expect(typeof privAfterSend.phoneHash).toBe('string');
    expect(typeof privAfterSend.phoneSalt).toBe('string');

    await request(app)
      .post('/api/security/verify-phone-code')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', code: sendRes.body.devCode })
      .expect(200);

    const pubAfterVerify = db.getRaw('tenantSecurity/tenant_A')!;
    expect(pubAfterVerify.phoneVerified).toBe(true);
    expect(pubAfterVerify.phoneVerifiedNumber).toBe('+237677123456'.replace('123456', '112233'));

    // Dispatch autorisé tant que tenant.phone == phoneVerifiedNumber
    await request(app)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', debtId: 'debt_1' })
      .expect(200);

    // Si le propriétaire change son numéro, dispatch est bloqué (403)
    await db.doc('tenants/tenant_A').update({ phone: '+237699887766' });
    await db.doc('tenants/tenant_A/debts/debt_1').update({ lastReminderAt: '2026-11-20T00:00:00Z' });
    await request(app)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', debtId: 'debt_1' })
      .expect(403);

    // En production sans OTP_PEPPER : send-phone-code refuse avec 503
    const { app: prodNoPepperApp } = setupHarness({
      isProduction: true,
      secrets: { otpPepper: '' },
    });
    await request(prodNoPepperApp)
      .post('/api/security/send-phone-code')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A' })
      .expect(503);
  });

  it('D1 : bloque les indicatifs non autorisés et limite à 5 codes/24h par numéro ainsi que 10 requêtes/h par IP', async () => {
    const { app, db, advanceMs } = setupHarness();

    // Numéro hors préfixe +237
    await db.doc('tenants/tenant_B').update({ phone: '+33612345678' });
    await request(app)
      .post('/api/security/send-phone-code')
      .set('Authorization', 'Bearer token_owner_b')
      .send({ tenantId: 'tenant_B' })
      .expect(400);

    // 5 codes sur 24h pour le même numéro de tenant_A (en espaçant de 2h pour dépasser la limite 3/h par uid:tenantId)
    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post('/api/security/send-phone-code')
        .set('Authorization', 'Bearer token_owner_a')
        .send({ tenantId: 'tenant_A' })
        .expect(200);
      if (i === 2) {
        advanceMs(2 * 60 * 60 * 1000);
      }
    }

    // 6e code dans la fenêtre 24h -> 429
    advanceMs(2 * 60 * 60 * 1000);
    await request(app)
      .post('/api/security/send-phone-code')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A' })
      .expect(429);

    // Plafond IP (10 requêtes / heure) sur un harness dédié avec plusieurs tenants
    const { app: ipApp, db: ipDb } = setupHarness();
    for (let i = 1; i <= 4; i += 1) {
      ipDb.seed(`tenants/tenant_ip_${i}`, {
        name: `Entreprise ${i}`,
        phone: `+23767700000${i}`,
        plan: 'free',
        ownerId: 'owner_A',
      });
      ipDb.seed(`tenants/tenant_ip_${i}/users/owner_A`, {
        tenantId: `tenant_ip_${i}`,
        uid: 'owner_A',
        role: 'owner',
        status: 'active',
      });
    }

    let successCount = 0;
    let rateLimitedStatus = 0;
    for (let i = 1; i <= 4; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        const res = await request(ipApp)
          .post('/api/security/send-phone-code')
          .set('Authorization', 'Bearer token_owner_a')
          .send({ tenantId: `tenant_ip_${i}` });
        if (res.status === 200) successCount += 1;
        else {
          rateLimitedStatus = res.status;
          break;
        }
      }
      if (rateLimitedStatus) break;
    }
    expect(successCount).toBe(10);
    expect(rateLimitedStatus).toBe(429);
  });

  // ==========================================================================
  // D2 : Liste d'opposition irréversible (STOP -> erase -> recréation)
  // ==========================================================================
  it('D2 : conserve l’opposition STOP après effacement RGPD et bloque un débiteur recréé avec optOut=false', async () => {
    const { app, db } = setupHarness();

    await request(app)
      .post('/api/simulate/whatsapp-inbound')
      .set('Authorization', 'Bearer token_owner_a')
      .send({
        tenantId: 'tenant_A',
        fromPhone: '+237677123456',
        messageText: 'STOP svp',
      })
      .expect(200);

    expect(db.getRaw('tenants/tenant_A/debtors/deb_1')?.optOut).toBe(true);

    // Effacement complet RGPD du débiteur
    await request(app)
      .post('/api/debtors/erase')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', debtorId: 'deb_1' })
      .expect(200);

    // Recréation frauduleuse du même numéro avec optOut=false
    db.seed('tenants/tenant_A/debtors/deb_recreated', {
      tenantId: 'tenant_A',
      name: 'Jean Fotso Recréé',
      phone: '+237677123456',
      preferredChannel: 'sms',
      optOut: false,
      reliabilityScore: 80,
    });
    db.seed('tenants/tenant_A/debts/debt_recreated', {
      tenantId: 'tenant_A',
      debtorId: 'deb_recreated',
      debtorName: 'Jean Fotso Recréé',
      debtorPhone: '+237677123456',
      initialAmount: 15000,
      remainingAmount: 15000,
      issuedAt: '2026-11-20',
      dueDate: '2026-11-25',
      status: 'en_cours',
      description: 'Nouvelle facture',
      reminderCount: 0,
    });

    await request(app)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', debtId: 'debt_recreated' })
      .expect(409);
  });

  // ==========================================================================
  // D3 : Atomicité cooldown 24h, plafond 7 jours et rollback complet
  // ==========================================================================
  it('D3 : sérialise les appels concurrents (Promise.all) pour 24h et plafond 7j, et annule les réservations si échec SMS', async () => {
    const { app, db } = setupHarness();

    // 2 appels concurrents sur la même dette => exactement 1 succès (200) et 1 conflit (409)
    const [r1, r2] = await Promise.all([
      request(app)
        .post('/api/reminders/dispatch')
        .set('Authorization', 'Bearer token_owner_a')
        .send({ tenantId: 'tenant_A', debtId: 'debt_1' }),
      request(app)
        .post('/api/reminders/dispatch')
        .set('Authorization', 'Bearer token_owner_a')
        .send({ tenantId: 'tenant_A', debtId: 'debt_1' }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(db.getRaw('tenants/tenant_A')?.remindersUsedThisMonth).toBe(1);
    const sendState = db.getRaw('tenants/tenant_A/debtorSendState/deb_1') as { sentTimestamps?: number[] };
    expect(sendState.sentTimestamps?.length).toBe(1);

    // 3 autres dettes pour le même débiteur en parallèle => max 3 au total sur 7j (2 réussissent, 1 échoue 409)
    for (const id of ['debt_2', 'debt_3', 'debt_4']) {
      db.seed(`tenants/tenant_A/debts/${id}`, {
        tenantId: 'tenant_A',
        debtorId: 'deb_1',
        debtorName: 'Jean Fotso',
        debtorPhone: '+237677123456',
        initialAmount: 10000,
        remainingAmount: 10000,
        issuedAt: '2026-11-10',
        dueDate: '2026-11-25',
        status: 'en_cours',
        description: `Facture ${id}`,
        reminderCount: 0,
      });
    }

    const batchRes = await Promise.all([
      request(app)
        .post('/api/reminders/dispatch')
        .set('Authorization', 'Bearer token_owner_a')
        .send({ tenantId: 'tenant_A', debtId: 'debt_2' }),
      request(app)
        .post('/api/reminders/dispatch')
        .set('Authorization', 'Bearer token_owner_a')
        .send({ tenantId: 'tenant_A', debtId: 'debt_3' }),
      request(app)
        .post('/api/reminders/dispatch')
        .set('Authorization', 'Bearer token_owner_a')
        .send({ tenantId: 'tenant_A', debtId: 'debt_4' }),
    ]);

    expect(batchRes.filter((r) => r.status === 200).length).toBe(2);
    expect(batchRes.filter((r) => r.status === 409).length).toBe(1);
    expect((db.getRaw('tenants/tenant_A/debtorSendState/deb_1') as { sentTimestamps?: number[] }).sentTimestamps?.length).toBe(3);

    // Échec fournisseur SMS => rollback lastReminderAt et debtorSendState.sentTimestamps
    const { app: failApp, db: failDb } = setupHarness({ smsShouldFail: true });
    await failDb.doc('tenants/tenant_A/debts/debt_1').update({ lastReminderAt: '2026-11-01T10:00:00.000Z' });
    await request(failApp)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer token_owner_a')
      .send({ tenantId: 'tenant_A', debtId: 'debt_1' })
      .expect(502);

    expect(failDb.getRaw('tenants/tenant_A/debts/debt_1')?.lastReminderAt).toBe('2026-11-01T10:00:00.000Z');
    const rolledBackState = failDb.getRaw('tenants/tenant_A/debtorSendState/deb_1') as { sentTimestamps?: number[] };
    expect(rolledBackState.sentTimestamps?.length).toBe(0);
  });

  // ==========================================================================
  // D5 : Rattrapage cron, compteurs par règle, curseur d'équité & TTL cronLocks
  // ==========================================================================
  it('D5 : rattrape un retard de +2j, sépare ruleReminderCounts du reminderCount manuel et pose expiresAt sur cronLocks', async () => {
    const { app, db, secrets, advanceMs } = setupHarness();

    // Dette avec 2 jours de retard (dueDate = 2026-11-23, aujourd'hui 2026-11-25) et 4 relances manuelles déjà faites
    await db.doc('tenants/tenant_A/debts/debt_1').update({
      dueDate: '2026-11-23',
      reminderCount: 4,
    });
    // Dette déjà payée (doit être ignorée par collectionGroup)
    db.seed('tenants/tenant_A/debts/debt_paid', {
      tenantId: 'tenant_A',
      debtorId: 'deb_1',
      debtorName: 'Jean Fotso',
      debtorPhone: '+237677123456',
      initialAmount: 10000,
      remainingAmount: 0,
      issuedAt: '2026-11-01',
      dueDate: '2026-11-25',
      status: 'payee',
      description: 'Soldée',
      reminderCount: 0,
    });

    const run1 = await request(app)
      .post('/api/cron/run-reminders')
      .set('x-cron-secret', secrets.cronSecret)
      .expect(200);

    expect(run1.body.sent).toBe(1);
    const updatedDebt = db.getRaw('tenants/tenant_A/debts/debt_1') as {
      appliedRuleOffsets?: number[];
      ruleReminderCounts?: Record<string, number>;
    };
    expect(updatedDebt.appliedRuleOffsets).toEqual([0]);
    expect(updatedDebt.ruleReminderCounts).toEqual({ '0': 1 });
    expect(db.getRaw('tenants/tenant_A')?.activeDebtsCount).toBe(1);

    // Vérifie expiresAt (+7j) sur le verrou cronLocks
    const lockDoc = db.getRaw(`cronLocks/run-reminders-${run1.body.slotKey}`) as { expiresAt?: Date };
    expect(lockDoc.expiresAt instanceof Date).toBe(true);

    // 25h plus tard : même dette a maintenant +3j de retard mais offset 0 est déjà dans appliedRuleOffsets => pas de ré-envoi
    advanceMs(25 * 60 * 60 * 1000);
    const run2 = await request(app)
      .post('/api/cron/run-reminders')
      .set('x-cron-secret', secrets.cronSecret)
      .expect(200);
    expect(run2.body.sent).toBe(0);
  });

  it('D5 : fait tourner le curseur d’équité entre entreprises lors de dépassement de budget temps', async () => {
    let harnessRef: ReturnType<typeof setupHarness> | null = null;
    harnessRef = setupHarness({
      cronTimeBudgetMs: 50,
      cronMaxConcurrency: 1,
      onSmsSend: () => {
        harnessRef?.advanceMs(100);
      },
    });
    const { app, db, secrets, advanceMs } = harnessRef;

    // Seed tenant_B et tenant_C avec dettes actives et règles Jour J
    for (const [tId, phone, debtorPhone] of [
      ['tenant_B', '+237699000111', '+237677991000'],
      ['tenant_C', '+237699000222', '+237677992000'],
    ] as const) {
      db.seed(`tenants/${tId}`, {
        name: `Boutique ${tId}`,
        phone,
        plan: 'starter',
        maxDebtors: 50,
        maxRemindersPerMonth: 200,
        maxRemindersPerDay: 40,
        remindersUsedThisMonth: 0,
        quotaResetMonth: '2026-11',
        quietHoursStart: 20,
        quietHoursEnd: 7,
        ownerId: `owner_${tId}`,
      });
      db.seed(`tenants/${tId}/debtors/deb_${tId}`, {
        tenantId: tId,
        name: `Client ${tId}`,
        phone: debtorPhone,
        preferredChannel: 'sms',
        optOut: false,
      });
      db.seed(`tenants/${tId}/debts/debt_${tId}`, {
        tenantId: tId,
        debtorId: `deb_${tId}`,
        debtorName: `Client ${tId}`,
        debtorPhone,
        initialAmount: 10000,
        remainingAmount: 10000,
        issuedAt: '2026-11-10',
        dueDate: '2026-11-25',
        status: 'en_cours',
        description: 'Facture',
        reminderCount: 0,
      });
      db.seed(`tenants/${tId}/reminderRules/rule_0`, {
        tenantId: tId,
        offsetDays: 0,
        label: 'Jour J',
        channel: 'sms',
        tone: 'amical',
        allowedStartHour: 8,
        allowedEndHour: 19,
        maxReminders: 4,
        enabled: true,
      });
      db.seed(`tenants/${tId}/reminderRules/rule_1`, {
        tenantId: tId,
        offsetDays: 1,
        label: 'J+1',
        channel: 'sms',
        tone: 'amical',
        allowedStartHour: 8,
        allowedEndHour: 19,
        maxReminders: 4,
        enabled: true,
      });
    }
    db.seed('tenants/tenant_A/reminderRules/rule_1', {
      tenantId: 'tenant_A',
      offsetDays: 1,
      label: 'J+1',
      channel: 'sms',
      tone: 'amical',
      allowedStartHour: 8,
      allowedEndHour: 19,
      maxReminders: 4,
      enabled: true,
    });

    const r1 = await request(app).post('/api/cron/run-reminders').set('x-cron-secret', secrets.cronSecret).expect(200);
    expect(r1.body.stoppedEarly).toBe(true);
    expect(r1.body.lastTenantId).toBe('tenant_A');

    advanceMs(16 * 60 * 1000);
    const r2 = await request(app).post('/api/cron/run-reminders').set('x-cron-secret', secrets.cronSecret).expect(200);
    expect(r2.body.stoppedEarly).toBe(true);
    expect(r2.body.lastTenantId).toBe('tenant_B');

    advanceMs(16 * 60 * 1000);
    const r3 = await request(app).post('/api/cron/run-reminders').set('x-cron-secret', secrets.cronSecret).expect(200);
    expect(r3.body.stoppedEarly).toBe(true);
    expect(r3.body.lastTenantId).toBe('tenant_C');

    // Retour au début après tenant_C (25h plus tard pour lever cooldown 24h sur tenant_A)
    advanceMs(25 * 60 * 60 * 1000);
    const r4 = await request(app).post('/api/cron/run-reminders').set('x-cron-secret', secrets.cronSecret).expect(200);
    expect(r4.body.lastTenantId).toBe('tenant_A');
  });

  // ==========================================================================
  // D6 : Gestionnaire d'erreurs Express JSON (zéro HTML ni fuite de pile)
  // ==========================================================================
  it('D6 : renvoie toujours du JSON (400 JSON malformé, 413 payload trop grand, 404 /api, 500 sans fuite)', async () => {
    const { app } = setupHarness();

    const badJson = await request(app)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer token_owner_a')
      .set('Content-Type', 'application/json')
      .send('{"tenantId": "tenant_A", broken}')
      .expect(400);
    expect(badJson.headers['content-type']).toMatch(/application\/json/);
    expect(badJson.body.errorId).toBeDefined();
    expect(badJson.text).not.toContain('<!DOCTYPE');

    const hugePayload = { tenantId: 'tenant_A', pad: 'x'.repeat(150_000) };
    const tooLarge = await request(app)
      .post('/api/reminders/dispatch')
      .set('Authorization', 'Bearer token_owner_a')
      .send(hugePayload)
      .expect(413);
    expect(tooLarge.headers['content-type']).toMatch(/application\/json/);
    expect(tooLarge.body.errorId).toBeDefined();

    const notFoundApi = await request(app).get('/api/route-inexistante').expect(404);
    expect(notFoundApi.headers['content-type']).toMatch(/application\/json/);
    expect(notFoundApi.body.error).toBeDefined();

    // Erreur interne inattendue : renvoie 500 JSON avec errorId et sans exposer le message interne
    const brokenApp = createApp({
      verifyIdToken: async () => ({ uid: 'owner_A', email: 'a@b.cm', email_verified: true }),
      db: {
        doc: () => {
          throw new Error('SECRET_INTERNAL_STACK_LEAK');
        },
        collection: () => {
          throw new Error('SECRET_INTERNAL_STACK_LEAK');
        },
        collectionGroup: () => {
          throw new Error('SECRET_INTERNAL_STACK_LEAK');
        },
        runTransaction: async () => {
          throw new Error('SECRET_INTERNAL_STACK_LEAK');
        },
        batch: () => {
          throw new Error('SECRET_INTERNAL_STACK_LEAK');
        },
      },
      fieldValue: {
        serverTimestamp: () => 'ts',
        increment: (n) => n,
        delete: () => 'del',
      },
      getSecrets: () => makeSecrets(),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const errRes = await request(brokenApp)
      .post('/api/billing/checkout')
      .set('Authorization', 'Bearer valid')
      .send({ tenantId: 'tenant_A', planId: 'pro' })
      .expect(500);
    expect(errRes.headers['content-type']).toMatch(/application\/json/);
    expect(errRes.body.errorId).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(errRes.body)).not.toContain('SECRET_INTERNAL_STACK_LEAK');
  });
});


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
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    providers: {
      createSmsProvider: () => ({
        name: 'test-sms',
        sendSms: async () => {
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
});

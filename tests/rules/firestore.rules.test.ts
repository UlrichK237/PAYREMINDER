import fs from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-payreminder';
const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');

let testEnv: RulesTestEnvironment;

const serverTs = () => firebase.firestore.FieldValue.serverTimestamp();

function validTenantPayload(ownerId: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Boutique Étoile Akwa',
    sector: 'Commerce & Boutique',
    phone: '+237677112233',
    email: 'owner@etoile.cm',
    plan: 'free',
    maxDebtors: 5,
    maxRemindersPerMonth: 30,
    remindersUsedThisMonth: 0,
    quotaResetMonth: '2026-11',
    subscriptionDate: '2026-11-25T10:00:00.000Z',
    quietHoursStart: 20,
    quietHoursEnd: 7,
    timezone: 'Africa/Douala',
    autoEscalate: true,
    fallbackToSms: true,
    ownerId,
    createdAt: serverTs(),
    updatedAt: serverTs(),
    ...overrides,
  };
}

function validOwnerUserPayload(tenantId: string, uid: string, email: string) {
  return {
    tenantId,
    uid,
    role: 'owner',
    name: 'Mama Clarisse',
    email,
    status: 'active',
    createdAt: serverTs(),
    updatedAt: serverTs(),
  };
}

function validDebtorPayload(tenantId: string, actorUid: string, overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    name: 'Paul Mbarga',
    phone: '+237677123456',
    preferredChannel: 'whatsapp',
    note: 'Client régulier',
    optOut: false,
    reliabilityScore: 85,
    consentConfirmedAt: '2026-11-25T10:00:00.000Z',
    consentConfirmedBy: actorUid,
    createdAt: serverTs(),
    updatedAt: serverTs(),
    ...overrides,
  };
}

async function seedTenantWithOwnerAndStaff() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('tenants/tenant_A').set({
      ...validTenantPayload('owner_A'),
      planExpiresAt: '2026-12-25T10:00:00.000Z',
      planStatus: 'active',
      createdAt: firebase.firestore.Timestamp.now(),
      updatedAt: firebase.firestore.Timestamp.now(),
    });
    await db.doc('tenants/tenant_A/users/owner_A').set({
      tenantId: 'tenant_A',
      uid: 'owner_A',
      role: 'owner',
      name: 'Propriétaire A',
      email: 'ownerA@etoile.cm',
      status: 'active',
      createdAt: firebase.firestore.Timestamp.now(),
      updatedAt: firebase.firestore.Timestamp.now(),
    });
    await db.doc('tenants/tenant_A/users/staff_A').set({
      tenantId: 'tenant_A',
      uid: 'staff_A',
      role: 'staff',
      name: 'Caissier A',
      email: 'staffA@etoile.cm',
      status: 'active',
      createdAt: firebase.firestore.Timestamp.now(),
      updatedAt: firebase.firestore.Timestamp.now(),
    });
    await db.doc('tenants/tenant_A/debtors/deb_1').set({
      tenantId: 'tenant_A',
      name: 'Client Seed',
      phone: '+237699001122',
      preferredChannel: 'sms',
      note: '',
      optOut: false,
      reliabilityScore: 80,
      consentConfirmedAt: '2026-11-25T10:00:00.000Z',
      consentConfirmedBy: 'owner_A',
      createdAt: firebase.firestore.Timestamp.now(),
      updatedAt: firebase.firestore.Timestamp.now(),
    });
    await db.doc('tenants/tenant_A/debts/debt_1').set({
      tenantId: 'tenant_A',
      debtorId: 'deb_1',
      debtorName: 'Client Seed',
      debtorPhone: '+237699001122',
      initialAmount: 20000,
      remainingAmount: 20000,
      issuedAt: '2026-11-20',
      dueDate: '2026-12-05',
      status: 'en_cours',
      description: 'Lot pagnes',
      reminderCount: 0,
      createdAt: firebase.firestore.Timestamp.now(),
      updatedAt: firebase.firestore.Timestamp.now(),
    });
    await db.doc('tenants/tenant_A/reminderRules/rule_1').set({
      tenantId: 'tenant_A',
      offsetDays: 0,
      label: 'Jour J',
      channel: 'sms',
      tone: 'amical',
      allowedStartHour: 8,
      allowedEndHour: 19,
      maxReminders: 4,
      enabled: true,
      updatedAt: firebase.firestore.Timestamp.now(),
    });
    await db.doc('tenants/tenant_A/messageTemplates/tpl_1').set({
      tenantId: 'tenant_A',
      tone: 'amical',
      channel: 'sms',
      body: 'Bonjour {nom}, merci de régler {montant_restant}.',
      updatedAt: firebase.firestore.Timestamp.now(),
    });
    await db.doc('tenants/tenant_A/billing/abo_1').set({
      tenantId: 'tenant_A',
      planId: 'pro',
      amountFcfa: 15000,
      status: 'paid',
      paymentRef: 'abo_1',
      createdBy: 'owner_A',
      createdAt: firebase.firestore.Timestamp.now(),
      updatedAt: firebase.firestore.Timestamp.now(),
    });
    await db.doc('tenants/tenant_A/paymentAnomalies/anom_1').set({
      tenantId: 'tenant_A',
      debtId: 'debt_1',
      transactionRef: 'TX-ANOM-1',
      reason: 'Trop-perçu test',
      receivedAmount: 25000,
      appliedAmount: 20000,
      excessAmount: 5000,
      createdAt: firebase.firestore.Timestamp.now(),
    });

    // Entreprise B pour tests d'isolation multi-tenant
    await db.doc('tenants/tenant_B').set({
      ...validTenantPayload('owner_B'),
      createdAt: firebase.firestore.Timestamp.now(),
      updatedAt: firebase.firestore.Timestamp.now(),
    });
    await db.doc('tenants/tenant_B/users/owner_B').set({
      tenantId: 'tenant_B',
      uid: 'owner_B',
      role: 'owner',
      name: 'Propriétaire B',
      email: 'ownerB@b.cm',
      status: 'active',
      createdAt: firebase.firestore.Timestamp.now(),
      updatedAt: firebase.firestore.Timestamp.now(),
    });
    await db.doc('tenants/tenant_B/debtors/deb_B1').set({
      tenantId: 'tenant_B',
      name: 'Client B',
      phone: '+237655001122',
      preferredChannel: 'sms',
      note: '',
      optOut: false,
      reliabilityScore: 80,
      consentConfirmedAt: '2026-11-25T10:00:00.000Z',
      consentConfirmedBy: 'owner_B',
      createdAt: firebase.firestore.Timestamp.now(),
      updatedAt: firebase.firestore.Timestamp.now(),
    });
  });
}

describe('Firestore Security Rules (Émulateur)', () => {
  beforeAll(async () => {
    const rules = fs.readFileSync(RULES_PATH, 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { host: '127.0.0.1', port: 8080 }),
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedTenantWithOwnerAndStaff();
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  describe('Cas qui doivent ÉCHOUER (assertFails)', () => {
    it('1. Refuser la modification de plan, maxDebtors, maxRemindersPerMonth ou planExpiresAt par le propriétaire', async () => {
      const ownerDb = testEnv.authenticatedContext('owner_A', { email: 'ownerA@etoile.cm', email_verified: true }).firestore();

      await assertFails(ownerDb.doc('tenants/tenant_A').update({ plan: 'business', updatedAt: serverTs() }));
      await assertFails(ownerDb.doc('tenants/tenant_A').update({ maxDebtors: 999999, updatedAt: serverTs() }));
      await assertFails(ownerDb.doc('tenants/tenant_A').update({ maxRemindersPerMonth: 999999, updatedAt: serverTs() }));
      await assertFails(ownerDb.doc('tenants/tenant_A').update({ planExpiresAt: '2099-01-01T00:00:00Z', updatedAt: serverTs() }));
    });

    it('2. Refuser la modification de remindersUsedThisMonth par un membre', async () => {
      const ownerDb = testEnv.authenticatedContext('owner_A', { email: 'ownerA@etoile.cm', email_verified: true }).firestore();
      const staffDb = testEnv.authenticatedContext('staff_A', { email: 'staffA@etoile.cm', email_verified: true }).firestore();

      await assertFails(ownerDb.doc('tenants/tenant_A').update({ remindersUsedThisMonth: 0, updatedAt: serverTs() }));
      await assertFails(staffDb.doc('tenants/tenant_A').update({ remindersUsedThisMonth: 0, updatedAt: serverTs() }));
    });

    it("3. Refuser la lecture et l'écriture d'un utilisateur de l'entreprise A dans l'entreprise B", async () => {
      const ownerADb = testEnv.authenticatedContext('owner_A', { email: 'ownerA@etoile.cm', email_verified: true }).firestore();

      await assertFails(ownerADb.doc('tenants/tenant_B/debtors/deb_B1').get());
      await assertFails(
        ownerADb.doc('tenants/tenant_B/debtors/deb_hack').set(validDebtorPayload('tenant_B', 'owner_A'))
      );
    });

    it('4. Refuser écriture débiteur avec email non vérifié ou sans preuve de consentement', async () => {
      const unverifiedDb = testEnv.authenticatedContext('owner_A', { email: 'ownerA@etoile.cm', email_verified: false }).firestore();
      await assertFails(
        unverifiedDb.doc('tenants/tenant_A/debtors/deb_unverified').set(validDebtorPayload('tenant_A', 'owner_A'))
      );

      const ownerADb = testEnv.authenticatedContext('owner_A', { email: 'ownerA@etoile.cm', email_verified: true }).firestore();
      const withoutConsent = validDebtorPayload('tenant_A', 'owner_A');
      delete (withoutConsent as Record<string, unknown>).consentConfirmedAt;
      delete (withoutConsent as Record<string, unknown>).consentConfirmedBy;
      await assertFails(ownerADb.doc('tenants/tenant_A/debtors/deb_noconsent').set(withoutConsent));
    });

    it('5. Refuser création d’un tenant avec plan "business" ou quotas non gratuits', async () => {
      const newOwnerUid = 'new_owner_1';
      const ctxDb = testEnv.authenticatedContext(newOwnerUid, { email: 'new1@etoile.cm', email_verified: true }).firestore();

      const batchBadPlan = ctxDb.batch();
      batchBadPlan.set(ctxDb.doc('tenants/tenant_bad_plan'), validTenantPayload(newOwnerUid, { plan: 'business' }));
      batchBadPlan.set(ctxDb.doc(`tenants/tenant_bad_plan/users/${newOwnerUid}`), validOwnerUserPayload('tenant_bad_plan', newOwnerUid, 'new1@etoile.cm'));
      await assertFails(batchBadPlan.commit());

      const batchBadQuota = ctxDb.batch();
      batchBadQuota.set(ctxDb.doc('tenants/tenant_bad_quota'), validTenantPayload(newOwnerUid, { maxDebtors: 100 }));
      batchBadQuota.set(ctxDb.doc(`tenants/tenant_bad_quota/users/${newOwnerUid}`), validOwnerUserPayload('tenant_bad_quota', newOwnerUid, 'new1@etoile.cm'));
      await assertFails(batchBadQuota.commit());
    });

    it("6. Refuser création d'un tenant sans le document users du propriétaire dans le même batch", async () => {
      const newOwnerUid = 'new_owner_2';
      const ctxDb = testEnv.authenticatedContext(newOwnerUid, { email: 'new2@etoile.cm', email_verified: true }).firestore();

      await assertFails(ctxDb.doc('tenants/tenant_orphan').set(validTenantPayload(newOwnerUid)));
    });

    it('7. Refuser toute écriture client dans reminders, messageLogs, billing, tenantSecurity, paymentAnomalies et auditLogs', async () => {
      const ownerDb = testEnv.authenticatedContext('owner_A', { email: 'ownerA@etoile.cm', email_verified: true }).firestore();

      await assertFails(
        ownerDb.doc('tenants/tenant_A/reminders/rem_hack').set({
          tenantId: 'tenant_A',
          debtId: 'debt_1',
          debtorId: 'deb_1',
          scheduledAt: '2026-11-25T10:00:00Z',
          channel: 'sms',
          tone: 'amical',
          status: 'envoyee',
          providerMessageId: 'hack',
          createdAt: serverTs(),
          updatedAt: serverTs(),
        })
      );
      await assertFails(
        ownerDb.doc('tenants/tenant_A/messageLogs/log_hack').set({
          tenantId: 'tenant_A',
          debtorId: 'deb_1',
          debtorName: 'Client',
          debtorPhone: '+237699001122',
          direction: 'outbound',
          channel: 'sms',
          content: 'Test',
          status: 'envoyee',
          providerMessageId: 'hack',
          detectedIntent: 'none',
          createdAt: serverTs(),
        })
      );
      await assertFails(
        ownerDb.doc('tenants/tenant_A/billing/abo_hack').set({
          tenantId: 'tenant_A',
          planId: 'business',
          amountFcfa: 0,
          status: 'paid',
          paymentRef: 'abo_hack',
          createdBy: 'owner_A',
          createdAt: serverTs(),
          updatedAt: serverTs(),
        })
      );
      await assertFails(
        ownerDb.doc('tenantSecurity/tenant_A').set({ phoneVerified: true, updatedAt: serverTs() }, { merge: true })
      );
      await assertFails(
        ownerDb.doc('tenants/tenant_A/paymentAnomalies/anom_hack').set({
          tenantId: 'tenant_A',
          debtId: 'debt_1',
          transactionRef: 'HACK',
          receivedAmount: 1000,
          createdAt: serverTs(),
        })
      );
      await assertFails(
        ownerDb.doc('tenants/tenant_A/auditLogs/audit_hack').set({
          tenantId: 'tenant_A',
          action: 'fake',
          createdAt: serverTs(),
        })
      );
    });

    it('8. Refuser la modification des règles de relance ou des modèles par un membre staff', async () => {
      const staffDb = testEnv.authenticatedContext('staff_A', { email: 'staffA@etoile.cm', email_verified: true }).firestore();

      await assertFails(
        staffDb.doc('tenants/tenant_A/reminderRules/rule_1').update({ enabled: false, updatedAt: serverTs() })
      );
      await assertFails(
        staffDb.doc('tenants/tenant_A/messageTemplates/tpl_1').update({
          body: 'Bonjour {nom}, merci de régler rapidement {montant_restant}.',
          updatedAt: serverTs(),
        })
      );
    });

    it('9. Refuser la suppression d’un tenant', async () => {
      const ownerDb = testEnv.authenticatedContext('owner_A', { email: 'ownerA@etoile.cm', email_verified: true }).firestore();
      await assertFails(ownerDb.doc('tenants/tenant_A').delete());
    });
  });

  describe('Cas qui doivent RÉUSSIR (assertSucceeds)', () => {
    it('1. Création complète tenant + user owner + userProfile + reminderRules + messageTemplates en un seul batch gratuit', async () => {
      const uid = 'creator_1';
      const email = 'creator@etoile.cm';
      const tenantId = 'tenant_new_1';
      const db = testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();

      const batch = db.batch();
      batch.set(db.doc(`tenants/${tenantId}`), validTenantPayload(uid, { email }));
      batch.set(db.doc(`tenants/${tenantId}/users/${uid}`), validOwnerUserPayload(tenantId, uid, email));
      batch.set(db.doc(`userProfiles/${uid}`), {
        uid,
        tenantId,
        role: 'owner',
        name: 'Mama Clarisse',
        email,
        updatedAt: serverTs(),
      });
      batch.set(db.doc(`tenants/${tenantId}/reminderRules/rule_1`), {
        tenantId,
        offsetDays: 0,
        label: 'Jour J',
        channel: 'sms',
        tone: 'amical',
        allowedStartHour: 8,
        allowedEndHour: 19,
        maxReminders: 4,
        enabled: true,
        updatedAt: serverTs(),
      });
      batch.set(db.doc(`tenants/${tenantId}/messageTemplates/tpl_1`), {
        tenantId,
        tone: 'amical',
        channel: 'sms',
        body: 'Bonjour {nom}, merci de régler {montant_restant}.',
        updatedAt: serverTs(),
      });

      await assertSucceeds(batch.commit());
    });

    it('2. Propriétaire modifie le nom du tenant même avec planExpiresAt et planStatus présents', async () => {
      const ownerDb = testEnv.authenticatedContext('owner_A', { email: 'ownerA@etoile.cm', email_verified: true }).firestore();
      await assertSucceeds(
        ownerDb.doc('tenants/tenant_A').update({ name: 'Boutique Étoile Douala', updatedAt: serverTs() })
      );
    });

    it('3. Membre crée un débiteur (avec consentement) puis une dette pour ce débiteur', async () => {
      const staffDb = testEnv.authenticatedContext('staff_A', { email: 'staffA@etoile.cm', email_verified: true }).firestore();

      await assertSucceeds(
        staffDb.doc('tenants/tenant_A/debtors/deb_new').set(validDebtorPayload('tenant_A', 'staff_A'))
      );
      await assertSucceeds(
        staffDb.doc('tenants/tenant_A/debts/debt_new').set({
          tenantId: 'tenant_A',
          debtorId: 'deb_new',
          debtorName: 'Paul Mbarga',
          debtorPhone: '+237677123456',
          initialAmount: 15000,
          remainingAmount: 15000,
          issuedAt: '2026-11-25',
          dueDate: '2026-12-10',
          status: 'en_cours',
          description: 'Facture textile',
          reminderCount: 0,
          createdAt: serverTs(),
          updatedAt: serverTs(),
        })
      );
    });

    it('4. Membre enregistre un paiement et met à jour remainingAmount de la dette dans un batch', async () => {
      const staffDb = testEnv.authenticatedContext('staff_A', { email: 'staffA@etoile.cm', email_verified: true }).firestore();

      const batch = staffDb.batch();
      batch.set(staffDb.doc('tenants/tenant_A/payments/pay_1'), {
        tenantId: 'tenant_A',
        debtId: 'debt_1',
        debtorId: 'deb_1',
        debtorName: 'Client Seed',
        amount: 5000,
        paidAt: '2026-11-25T11:00:00.000Z',
        method: 'mtn_momo',
        note: 'Acompte',
        receiptNumber: 'REC-2026-0001',
        createdBy: 'staff_A',
        createdAt: serverTs(),
      });
      batch.update(staffDb.doc('tenants/tenant_A/debts/debt_1'), {
        remainingAmount: 15000,
        status: 'partiellement_payee',
        updatedAt: serverTs(),
      });

      await assertSucceeds(batch.commit());
    });

    it('5. Propriétaire lit billing et paymentAnomalies, tandis que staff ne peut pas les lire', async () => {
      const ownerDb = testEnv.authenticatedContext('owner_A', { email: 'ownerA@etoile.cm', email_verified: true }).firestore();
      const staffDb = testEnv.authenticatedContext('staff_A', { email: 'staffA@etoile.cm', email_verified: true }).firestore();

      await assertSucceeds(ownerDb.doc('tenants/tenant_A/billing/abo_1').get());
      await assertSucceeds(ownerDb.doc('tenants/tenant_A/paymentAnomalies/anom_1').get());

      await assertFails(staffDb.doc('tenants/tenant_A/billing/abo_1').get());
      await assertFails(staffDb.doc('tenants/tenant_A/paymentAnomalies/anom_1').get());
    });

    it('6. D1/D2/D3/D5 — Règles de confidentialité OTP, opt-out irréversible, suppressions, debtorSendState et champs serveur', async () => {
      const ownerDb = testEnv.authenticatedContext('owner_A', { email: 'ownerA@etoile.cm', email_verified: true }).firestore();
      const staffDb = testEnv.authenticatedContext('staff_A', { email: 'staffA@etoile.cm', email_verified: true }).firestore();

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const admin = ctx.firestore();
        await admin.doc('tenantSecurityPrivate/tenant_A').set({
          tenantId: 'tenant_A',
          phoneHash: 'secret_hmac',
          phoneSalt: 'salt',
        });
        await admin.doc('tenants/tenant_A/suppressions/hash_1').set({
          tenantId: 'tenant_A',
          phoneHash: 'hash_1',
          reason: 'whatsapp_stop',
          createdAt: firebase.firestore.Timestamp.now(),
        });
        await admin.doc('tenants/tenant_A/debtorSendState/deb_1').set({
          tenantId: 'tenant_A',
          debtorId: 'deb_1',
          sentTimestamps: [1732530000000],
          updatedAt: firebase.firestore.Timestamp.now(),
        });
      });

      // D1 : tenantSecurityPrivate interdit en lecture et écriture pour tous les clients
      await assertFails(ownerDb.doc('tenantSecurityPrivate/tenant_A').get());
      await assertFails(staffDb.doc('tenantSecurityPrivate/tenant_A').get());
      await assertFails(ownerDb.doc('tenantSecurityPrivate/tenant_A').set({ phoneHash: 'x' }));

      // D2 : optOut false -> true autorisé, mais true -> false refusé ; suppressions interdites
      await assertSucceeds(
        staffDb.doc('tenants/tenant_A/debtors/deb_1').update({ optOut: true, updatedAt: serverTs() })
      );
      await assertFails(
        ownerDb.doc('tenants/tenant_A/debtors/deb_1').update({ optOut: false, updatedAt: serverTs() })
      );
      await assertFails(ownerDb.doc('tenants/tenant_A/suppressions/hash_1').get());
      await assertFails(ownerDb.doc('tenants/tenant_A/suppressions/hash_1').delete());

      // D3 : debtorSendState lisible par les membres, écriture interdite
      await assertSucceeds(staffDb.doc('tenants/tenant_A/debtorSendState/deb_1').get());
      await assertFails(
        ownerDb.doc('tenants/tenant_A/debtorSendState/deb_1').set({
          tenantId: 'tenant_A',
          debtorId: 'deb_1',
          sentTimestamps: [],
          updatedAt: serverTs(),
        })
      );

      // D5 : champs serveur appliedRuleOffsets, ruleReminderCounts et activeDebtsCount protégés
      await assertFails(
        ownerDb.doc('tenants/tenant_A/debts/debt_1').update({
          appliedRuleOffsets: [0],
          updatedAt: serverTs(),
        })
      );
      await assertFails(
        ownerDb.doc('tenants/tenant_A/debts/debt_1').update({
          ruleReminderCounts: { '0': 0 },
          updatedAt: serverTs(),
        })
      );
      await assertFails(
        ownerDb.doc('tenants/tenant_A').update({
          activeDebtsCount: 99,
          updatedAt: serverTs(),
        })
      );

      // E2 : otpDestinations interdit en lecture et écriture côté client
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc('otpDestinations/hash_dest_1').set({
          phoneDestHash: 'hash_dest_1',
          sentTimestamps: [1732530000000],
          expiresAt: firebase.firestore.Timestamp.now(),
        });
      });
      await assertFails(ownerDb.doc('otpDestinations/hash_dest_1').get());
      await assertFails(staffDb.doc('otpDestinations/hash_dest_1').get());
      await assertFails(
        ownerDb.doc('otpDestinations/hash_dest_1').set({
          phoneDestHash: 'hash_dest_1',
          sentTimestamps: [],
        })
      );

      // E3 : ruleLastSentAt protégé en création et mise à jour côté client
      await assertFails(
        ownerDb.doc('tenants/tenant_A/debts/debt_1').update({
          ruleLastSentAt: { '0': '2026-11-25T10:00:00.000Z' },
          updatedAt: serverTs(),
        })
      );
      await assertFails(
        ownerDb.doc('tenants/tenant_A/debts/debt_hack_e3').set({
          tenantId: 'tenant_A',
          debtorId: 'deb_1',
          debtorName: 'Client Seed',
          debtorPhone: '+237699001122',
          initialAmount: 5000,
          remainingAmount: 5000,
          issuedAt: '2026-11-25',
          dueDate: '2026-12-05',
          status: 'en_cours',
          description: 'Hack E3',
          reminderCount: 0,
          ruleLastSentAt: { '0': '2026-11-25T10:00:00.000Z' },
          createdAt: serverTs(),
          updatedAt: serverTs(),
        })
      );
    });
  });
});



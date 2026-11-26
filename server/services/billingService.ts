import { adminDb, FieldValue } from '../firebaseAdmin';
import type { FieldValueLike, FirestoreLike } from '../types';
import type { PlanId } from '../../src/types/payreminder';
import { PLANS } from '../../src/utils/plans';
import { writeAuditLogInTx } from './auditService';

function isValidPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && Object.hasOwn(PLANS, value);
}

export interface SubscriptionConfirmationResult {
  ok: boolean;
  verified: boolean;
  idempotent: boolean;
  reason?: string;
  amountMismatch?: boolean;
  planId?: PlanId;
  paymentRef: string;
  receiptNumber?: string;
  planExpiresAt?: string;
  receivedAmount: number;
  expectedAmount?: number;
}

export interface BillingServiceDeps {
  db?: FirestoreLike;
  fieldValue?: FieldValueLike;
  now?: () => number;
}

/**
 * Active un abonnement après vérification du document billing et du montant exact.
 * Utilisé par POST /api/webhooks/subscription-payment et POST /api/simulate/subscription-payment.
 */
export async function processSubscriptionPaymentConfirmation(
  params: {
    tenantId: string;
    paymentRef: string;
    amount: number;
    method?: string;
    transactionRef: string;
  },
  deps: BillingServiceDeps = {}
): Promise<SubscriptionConfirmationResult> {
  const db: FirestoreLike = deps.db ?? (adminDb as unknown as FirestoreLike);
  const fieldValue: FieldValueLike = deps.fieldValue ?? (FieldValue as unknown as FieldValueLike);
  const nowFn = deps.now ?? (() => Date.now());

  const cleanPayRef = params.paymentRef.trim();
  const cleanTxRef = params.transactionRef.trim();
  const receivedAmount = Math.round(params.amount);
  const safeMethod = params.method === 'orange_money' ? 'orange_money' : 'mtn_momo';
  const safeAnomSuffix = `${cleanPayRef}_${cleanTxRef}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);

  const billingRef = db.doc(`tenants/${params.tenantId}/billing/${cleanPayRef}`);
  const tenantRef = db.doc(`tenants/${params.tenantId}`);
  const anomalyRef = db.doc(`tenants/${params.tenantId}/paymentAnomalies/anom_sub_${safeAnomSuffix}`);

  return db.runTransaction(async (tx) => {
    const [billingSnap, tenantSnap, existingAnomaly] = await Promise.all([
      tx.get(billingRef),
      tx.get(tenantRef),
      tx.get(anomalyRef),
    ]);

    const nowMs = nowFn();
    const nowIso = new Date(nowMs).toISOString();

    if (!billingSnap.exists) {
      if (!existingAnomaly.exists) {
        tx.set(anomalyRef, {
          tenantId: params.tenantId,
          debtId: cleanPayRef,
          paymentRef: cleanPayRef,
          transactionRef: cleanTxRef,
          type: 'subscription_missing_billing',
          reason: 'Document billing introuvable',
          receivedAmount,
          appliedAmount: 0,
          excessAmount: receivedAmount,
          recordedAt: nowIso,
          createdAt: fieldValue.serverTimestamp(),
        });
      }
      return {
        ok: false,
        verified: true,
        idempotent: existingAnomaly.exists,
        reason: 'Demande de paiement abonnement introuvable.',
        paymentRef: cleanPayRef,
        receivedAmount,
      };
    }

    const billing = billingSnap.data() as {
      planId?: string;
      amountFcfa?: number;
      status?: string;
      receiptNumber?: string;
      createdBy?: string;
    };

    // Idempotence : si déjà payé, ne pas prolonger une seconde fois
    if (billing.status === 'paid') {
      return {
        ok: true,
        verified: true,
        idempotent: true,
        planId: isValidPlanId(billing.planId) ? billing.planId : undefined,
        paymentRef: cleanPayRef,
        receiptNumber: billing.receiptNumber,
        receivedAmount,
        expectedAmount: billing.amountFcfa,
      };
    }

    if (billing.status !== 'pending') {
      if (!existingAnomaly.exists) {
        tx.set(anomalyRef, {
          tenantId: params.tenantId,
          debtId: cleanPayRef,
          paymentRef: cleanPayRef,
          transactionRef: cleanTxRef,
          type: 'subscription_invalid_status',
          reason: `Statut billing invalide (${billing.status || 'inconnu'})`,
          receivedAmount,
          appliedAmount: 0,
          excessAmount: receivedAmount,
          recordedAt: nowIso,
          createdAt: fieldValue.serverTimestamp(),
        });
      }
      return {
        ok: false,
        verified: true,
        idempotent: existingAnomaly.exists,
        reason: 'Cette demande de paiement abonnement n’est plus en attente.',
        paymentRef: cleanPayRef,
        receivedAmount,
      };
    }

    if (!isValidPlanId(billing.planId) || billing.planId === 'free') {
      return {
        ok: false,
        verified: true,
        idempotent: false,
        reason: 'Forfait payant invalide sur le document billing.',
        paymentRef: cleanPayRef,
        receivedAmount,
      };
    }

    const planDef = PLANS[billing.planId];
    const expectedAmount = planDef.priceFcfa;

    // Tout écart de montant est tracé dans paymentAnomalies et le forfait n'est PAS activé
    if (receivedAmount !== expectedAmount || receivedAmount !== Math.round(Number(billing.amountFcfa || 0))) {
      if (!existingAnomaly.exists) {
        tx.set(anomalyRef, {
          tenantId: params.tenantId,
          debtId: cleanPayRef,
          paymentRef: cleanPayRef,
          transactionRef: cleanTxRef,
          type: 'subscription_amount_mismatch',
          reason: `Montant reçu (${receivedAmount} FCFA) différent du prix du forfait (${expectedAmount} FCFA)`,
          receivedAmount,
          expectedAmount,
          appliedAmount: 0,
          excessAmount: Math.max(0, receivedAmount - expectedAmount),
          recordedAt: nowIso,
          createdAt: fieldValue.serverTimestamp(),
        });
      }
      return {
        ok: false,
        verified: true,
        idempotent: existingAnomaly.exists,
        amountMismatch: true,
        reason: 'Montant reçu différent du prix du forfait.',
        paymentRef: cleanPayRef,
        receivedAmount,
        expectedAmount,
      };
    }

    if (!tenantSnap.exists) {
      return {
        ok: false,
        verified: true,
        idempotent: false,
        reason: 'Entreprise introuvable.',
        paymentRef: cleanPayRef,
        receivedAmount,
        expectedAmount,
      };
    }

    const tenantData = tenantSnap.data() as {
      planStatus?: string;
      planExpiresAt?: string;
    };

    let baseExpiryMs = nowMs;
    if (tenantData.planStatus === 'active' && tenantData.planExpiresAt) {
      const existingExpMs = Date.parse(tenantData.planExpiresAt);
      if (Number.isFinite(existingExpMs) && existingExpMs > nowMs) {
        baseExpiryMs = existingExpMs;
      }
    }

    const newExpiresAtIso = new Date(baseExpiryMs + 30 * 24 * 60 * 60 * 1000).toISOString();
    const receiptNumber = `ABO-${nowIso.slice(0, 4)}-${cleanPayRef.slice(-6).toUpperCase()}`;

    tx.update(tenantRef, {
      plan: billing.planId,
      maxDebtors: planDef.maxDebtors,
      maxRemindersPerMonth: planDef.maxRemindersPerMonth,
      maxRemindersPerDay: planDef.maxRemindersPerDay,
      subscriptionDate: nowIso,
      planExpiresAt: newExpiresAtIso,
      planStatus: 'active',
      lastPaymentAt: nowIso,
      updatedAt: fieldValue.serverTimestamp(),
    });

    tx.update(billingRef, {
      status: 'paid',
      receiptNumber,
      transactionRef: cleanTxRef,
      method: safeMethod,
      paidAt: nowIso,
      updatedAt: fieldValue.serverTimestamp(),
    });

    writeAuditLogInTx(
      tx,
      db,
      fieldValue,
      {
        tenantId: params.tenantId,
        action: 'subscription_payment',
        actorUid: billing.createdBy || 'webhook_payment',
        targetId: cleanPayRef,
        summary: `Abonnement ${planDef.name} activé (${expectedAmount} FCFA, reçu ${receiptNumber})`,
        metadata: {
          planId: billing.planId,
          amountFcfa: expectedAmount,
          receiptNumber,
          method: safeMethod,
        },
      },
      nowMs
    );

    return {
      ok: true,
      verified: true,
      idempotent: false,
      planId: billing.planId,
      paymentRef: cleanPayRef,
      receiptNumber,
      planExpiresAt: newExpiresAtIso,
      receivedAmount,
      expectedAmount,
    };
  });
}

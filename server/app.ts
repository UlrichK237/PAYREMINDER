import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import {
  getServerSecrets,
  HttpError,
  isProduction as defaultIsProduction,
  simulationRoutesEnabled as defaultSimRoutesEnabled,
} from './config';
import { logger as defaultLogger } from './logger';
import { writeAuditLog } from './services/auditService';
import { processSubscriptionPaymentConfirmation } from './services/billingService';
import { createPaymentProvider as defaultCreatePaymentProvider } from './services/payment';
import { sendReminderForDebt } from './services/reminderService';
import { createSmsProvider as defaultCreateSmsProvider } from './services/sms';
import { analyzeInboundMessage, sendWhatsAppTemplateMessage as defaultSendWhatsApp } from './services/whatsapp';
import type { AppDeps, DocSnapshotLike, FirestoreLike, FieldValueLike } from './types';
import type { Channel, PlanId, Tone } from '../src/types/payreminder';
import {
  computeDebtStatus,
  DOUALA_TIMEZONE,
  getCurrentDoualaHour,
  getCurrentDoualaMonth,
  getDaysOverdue,
  getTodayDoualaDate,
  pickEscalatedTone,
} from '../src/utils/formatters';
import { PLANS } from '../src/utils/plans';

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

interface AuthContext {
  uid: string;
  email: string;
}

interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
  rawBody?: Buffer;
}

export function isValidPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && Object.hasOwn(PLANS, value);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyWebhookHmac(params: {
  rawBody?: Buffer;
  signatureHeader?: string;
  secret: string;
  secretEnvName: string;
  isProduction?: boolean;
}): { ok: boolean; error?: string } {
  const prod = params.isProduction ?? defaultIsProduction;
  if (!params.secret) {
    if (!prod) {
      return { ok: true };
    }
    return { ok: false, error: `${params.secretEnvName} non configuré en production.` };
  }

  if (!params.rawBody || !params.signatureHeader) {
    return { ok: false, error: 'Signature webhook manquante.' };
  }

  const expectedHex = crypto.createHmac('sha256', params.secret).update(params.rawBody).digest('hex');
  const expectedPrefixed = `sha256=${expectedHex}`;
  const provided = params.signatureHeader.trim();

  if (constantTimeEquals(provided, expectedPrefixed) || constantTimeEquals(provided, expectedHex)) {
    return { ok: true };
  }
  return { ok: false, error: 'Signature webhook invalide.' };
}

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && VALID_ID_REGEX.test(value);
}

function makeDocId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function hashPhoneCode(salt: string, code: string): string {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

export function getQuarterHourSlotKeyDouala(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DOUALA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  const hourNum = Number(map.hour || '0') % 24;
  const minNum = Number(map.minute || '0');
  const roundedMin = Math.floor(minNum / 15) * 15;
  const hh = String(hourNum).padStart(2, '0');
  const mm = String(roundedMin).padStart(2, '0');
  return `${map.year}-${map.month}-${map.day}-${hh}-${mm}`;
}

export function isWithinQuietHours(hour: number, quietStart: number, quietEnd: number): boolean {
  if (quietStart > quietEnd) {
    return hour >= quietStart || hour < quietEnd;
  }
  if (quietStart < quietEnd) {
    return hour >= quietStart && hour < quietEnd;
  }
  return false;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

async function deleteRefsInBatches(
  db: FirestoreLike,
  refs: Array<{ path: string; ref: DocSnapshotLike['ref'] }>
): Promise<void> {
  const CHUNK_SIZE = 400;
  for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
    const chunk = refs.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    for (const item of chunk) {
      batch.delete(item.ref);
    }
    await batch.commit();
  }
}

export function createApp(deps: AppDeps) {
  const app = express();
  const db: FirestoreLike = deps.db;
  const fieldValue: FieldValueLike = deps.fieldValue;
  const nowFn = deps.now ?? (() => Date.now());
  const getSecrets = deps.getSecrets ?? getServerSecrets;
  const isProd = deps.isProduction ?? defaultIsProduction;
  const simRoutesEnabled = deps.simulationRoutesEnabled ?? defaultSimRoutesEnabled;
  const log = deps.logger ?? defaultLogger;

  const createPaymentProvider = deps.providers?.createPaymentProvider ?? defaultCreatePaymentProvider;
  const createSmsProvider = deps.providers?.createSmsProvider ?? defaultCreateSmsProvider;
  const sendWhatsAppTemplateMessage = deps.providers?.sendWhatsAppTemplateMessage ?? defaultSendWhatsApp;
  const sendEmail =
    deps.providers?.sendEmail ??
    (async (params) => {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: params.from,
          to: [params.to],
          subject: params.subject,
          html: params.html,
        }),
      });
      const bodyText = resp.ok ? undefined : await resp.text().catch(() => '');
      return { ok: resp.ok, status: resp.status, bodyText };
    });

  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(
    express.json({
      limit: '100kb',
      verify: (req, _res, buf) => {
        (req as AuthenticatedRequest).rawBody = buf;
      },
    })
  );

  // ==========================================================================
  // Middlewares d'authentification, RBAC, cron & gestion d'erreurs sûre
  // ==========================================================================
  async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Jeton d’authentification manquant.' });
        return;
      }

      const idToken = authHeader.slice('Bearer '.length).trim();
      if (!idToken) {
        res.status(401).json({ error: 'Jeton d’authentification invalide.' });
        return;
      }

      const decoded = await deps.verifyIdToken(idToken);
      if (decoded.email_verified !== true) {
        res.status(401).json({ error: 'Adresse email non vérifiée.' });
        return;
      }

      (req as AuthenticatedRequest).auth = {
        uid: decoded.uid,
        email: decoded.email || '',
      };
      next();
    } catch {
      res.status(401).json({ error: 'Jeton d’authentification expiré ou invalide.' });
    }
  }

  function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
    const secrets = getSecrets();
    if (!secrets.cronSecret) {
      res.status(503).json({ error: 'CRON_SECRET non configuré sur le serveur.' });
      return;
    }

    const providedSecret = req.header('x-cron-secret') || '';
    if (!constantTimeEquals(providedSecret, secrets.cronSecret)) {
      res.status(401).json({ error: 'Secret cron invalide.' });
      return;
    }

    next();
  }

  async function requireTenantMember(
    uid: string,
    tenantId: string
  ): Promise<{ role: 'owner' | 'staff'; status: string; name: string; email: string }> {
    if (!isValidId(tenantId)) {
      throw new HttpError(400, 'Identifiant entreprise invalide.');
    }
    const memberSnap = await db.doc(`tenants/${tenantId}/users/${uid}`).get();
    if (!memberSnap.exists) {
      throw new HttpError(403, 'Accès refusé à cette entreprise.');
    }
    const data = memberSnap.data() as {
      role?: 'owner' | 'staff';
      status?: string;
      name?: string;
      email?: string;
    };
    if (data.status !== 'active') {
      throw new HttpError(403, 'Compte membre inactif.');
    }
    return {
      role: data.role === 'owner' ? 'owner' : 'staff',
      status: data.status,
      name: data.name || '',
      email: data.email || '',
    };
  }

  async function requireTenantOwner(uid: string, tenantId: string) {
    const member = await requireTenantMember(uid, tenantId);
    if (member.role !== 'owner') {
      throw new HttpError(403, 'Action réservée au propriétaire de l’entreprise.');
    }
    return member;
  }

  const uidRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthenticatedRequest).auth?.uid || 'anonymous',
    message: { error: 'Trop de requêtes (limite : 30 par minute). Patientez quelques instants.' },
  });

  const phoneCodeRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const uid = (req as AuthenticatedRequest).auth?.uid || 'anonymous';
      const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId : 'unknown';
      return `${uid}:${tenantId}`;
    },
    message: { error: 'Limite de 3 codes par heure atteinte. Réessayez plus tard.' },
  });

  function handleRouteError(res: Response, error: unknown, contextLabel: string): void {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    const errorId = crypto.randomBytes(6).toString('hex');
    log.error({ errorId, context: contextLabel, err: error }, 'Internal server error');
    res.status(500).json({
      error: 'Erreur interne du serveur.',
      errorId,
    });
  }

  const requireSimulationRoutesEnabled = (_req: Request, res: Response, next: NextFunction): void => {
    if (!simRoutesEnabled) {
      res.status(404).json({ error: 'Route de simulation indisponible.' });
      return;
    }
    next();
  };

  const requireNonProduction = (_req: Request, res: Response, next: NextFunction): void => {
    if (isProd) {
      res.status(404).json({ error: 'Route désactivée en production. Utilisez /api/billing/checkout.' });
      return;
    }
    next();
  };

  // ==========================================================================
  // Logique réutilisable des webhooks entrants & paiement de dettes
  // ==========================================================================
  async function processInboundWhatsapp(params: {
    fromPhone: string;
    messageText: string;
    tenantId?: string;
    providerMessageId?: string;
  }): Promise<{
    ok: true;
    intent: 'opt_out' | 'promise' | 'none';
    promiseDate: string | null;
  }> {
    const normalizedFrom =
      params.fromPhone && !params.fromPhone.startsWith('+') && /^[0-9]{8,15}$/.test(params.fromPhone)
        ? `+${params.fromPhone}`
        : params.fromPhone;

    const analysis = analyzeInboundMessage(params.messageText);
    const providerId = params.providerMessageId || `wa_in_${nowFn()}`;

    const applyForDebtorDoc = async (debtorDoc: DocSnapshotLike, resolvedTenantId: string) => {
      const debtor = (debtorDoc.data() || {}) as {
        tenantId?: string;
        name?: string;
        phone?: string;
        note?: string;
      };
      const batch = db.batch();
      const logId = makeDocId('log_in');

      batch.set(db.doc(`tenants/${resolvedTenantId}/messageLogs/${logId}`), {
        tenantId: resolvedTenantId,
        debtorId: debtorDoc.id,
        debtorName: debtor.name || 'Client',
        debtorPhone: debtor.phone || normalizedFrom,
        direction: 'inbound',
        channel: 'whatsapp',
        content: params.messageText.slice(0, 1500),
        status: 'recue',
        providerMessageId: providerId,
        detectedIntent: analysis.intent,
        ...(analysis.promiseDate ? { promiseDate: analysis.promiseDate } : {}),
        createdAt: fieldValue.serverTimestamp(),
      });

      if (analysis.intent === 'opt_out') {
        batch.update(debtorDoc.ref, {
          optOut: true,
          updatedAt: fieldValue.serverTimestamp(),
        });
      } else if (analysis.intent === 'promise' && analysis.promiseDate) {
        const updatedNote = `${debtor.note ? `${debtor.note} | ` : ''}Promesse (${analysis.promiseDate}) : ${params.messageText}`.slice(
          0,
          500
        );
        batch.update(debtorDoc.ref, {
          promiseDate: analysis.promiseDate,
          note: updatedNote,
          updatedAt: fieldValue.serverTimestamp(),
        });
      }

      await batch.commit();
    };

    if (params.tenantId && isValidId(params.tenantId)) {
      const debtorsCol = db.collection(`tenants/${params.tenantId}/debtors`);
      let targetSnap = normalizedFrom
        ? await debtorsCol.where('phone', '==', normalizedFrom).limit(1).get()
        : null;

      if (!targetSnap || targetSnap.empty) {
        targetSnap = await debtorsCol.limit(1).get();
      }

      if (!targetSnap.empty) {
        await applyForDebtorDoc(targetSnap.docs[0], params.tenantId);
      }
    } else if (normalizedFrom) {
      const matchedDebtors = await db
        .collectionGroup('debtors')
        .where('phone', '==', normalizedFrom)
        .limit(5)
        .get();

      for (const debtorDoc of matchedDebtors.docs) {
        const debtor = (debtorDoc.data() || {}) as { tenantId?: string };
        if (debtor.tenantId && isValidId(debtor.tenantId)) {
          await applyForDebtorDoc(debtorDoc, debtor.tenantId);
        }
      }
    }

    return {
      ok: true,
      intent: analysis.intent,
      promiseDate: analysis.promiseDate || null,
    };
  }

  async function processPaymentConfirmation(params: {
    tenantId: string;
    debtId: string;
    amount: number;
    method?: string;
    transactionRef: string;
  }): Promise<{
    ok: boolean;
    verified: boolean;
    idempotent: boolean;
    reason?: string;
    debtId: string;
    amount?: number;
    receivedAmount?: number;
    excessAmount?: number;
    remainingAmount?: number;
    status?: string;
    method: 'mtn_momo' | 'orange_money';
    transactionRef: string;
  }> {
    const cleanRef = params.transactionRef.trim();
    const safeRefSuffix = cleanRef.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
    const safePayDocId = `pay_wh_${safeRefSuffix}`;
    const safeAnomDocId = `anom_${safeRefSuffix}`;
    const safeMethod = params.method === 'orange_money' ? 'orange_money' : 'mtn_momo';
    const receivedAmount = Math.round(params.amount);

    const paymentDocRef = db.doc(`tenants/${params.tenantId}/payments/${safePayDocId}`);
    const anomalyDocRef = db.doc(`tenants/${params.tenantId}/paymentAnomalies/${safeAnomDocId}`);
    const debtDocRef = db.doc(`tenants/${params.tenantId}/debts/${params.debtId}`);

    const txResult = await db.runTransaction(async (tx) => {
      const [existingPay, existingAnomaly] = await Promise.all([
        tx.get(paymentDocRef),
        tx.get(anomalyDocRef),
      ]);

      if (existingPay.exists) {
        const payData = existingPay.data() as { amount?: number };
        return {
          ok: true,
          idempotent: true,
          appliedAmount: Number(payData.amount || 0),
          excessAmount: 0,
        };
      }

      if (existingAnomaly.exists) {
        const anomData = existingAnomaly.data() as { reason?: string; appliedAmount?: number };
        return {
          ok: false,
          idempotent: true,
          reason: anomData.reason || 'Transaction déjà enregistrée comme anomalie.',
          appliedAmount: Number(anomData.appliedAmount || 0),
          excessAmount: 0,
        };
      }

      const debtSnap = await tx.get(debtDocRef);
      const nowIso = new Date(nowFn()).toISOString();

      if (!debtSnap.exists) {
        tx.set(anomalyDocRef, {
          tenantId: params.tenantId,
          debtId: params.debtId,
          transactionRef: cleanRef,
          reason: 'Dette introuvable',
          receivedAmount,
          appliedAmount: 0,
          excessAmount: receivedAmount,
          recordedAt: nowIso,
          createdAt: fieldValue.serverTimestamp(),
        });
        return {
          ok: false,
          idempotent: false,
          reason: 'Dette introuvable.',
          appliedAmount: 0,
          excessAmount: receivedAmount,
        };
      }

      const debt = debtSnap.data() as {
        debtorId: string;
        debtorName: string;
        initialAmount: number;
        remainingAmount: number;
        dueDate: string;
        status: string;
      };

      const currentRemaining = Math.round(Number(debt.remainingAmount || 0));
      if (debt.status === 'payee' || debt.status === 'annulee' || currentRemaining <= 0) {
        tx.set(anomalyDocRef, {
          tenantId: params.tenantId,
          debtId: params.debtId,
          transactionRef: cleanRef,
          reason: `Dette déjà ${debt.status}`,
          receivedAmount,
          appliedAmount: 0,
          excessAmount: receivedAmount,
          recordedAt: nowIso,
          createdAt: fieldValue.serverTimestamp(),
        });
        return {
          ok: false,
          idempotent: false,
          reason: 'Cette dette est déjà soldée ou annulée.',
          appliedAmount: 0,
          excessAmount: receivedAmount,
        };
      }

      const appliedAmount = Math.min(receivedAmount, currentRemaining);
      const excessAmount = Math.max(0, receivedAmount - appliedAmount);
      const newRemaining = currentRemaining - appliedAmount;

      const newStatus =
        newRemaining === 0
          ? 'payee'
          : computeDebtStatus(
              {
                initialAmount: Number(debt.initialAmount || currentRemaining),
                remainingAmount: newRemaining,
                dueDate: debt.dueDate,
                status: 'partiellement_payee',
              },
              getTodayDoualaDate(new Date(nowFn()))
            );

      const receiptNumber = `REC-${nowIso.slice(0, 4)}-${cleanRef.slice(-6).toUpperCase()}`;

      tx.set(paymentDocRef, {
        tenantId: params.tenantId,
        debtId: params.debtId,
        debtorId: debt.debtorId,
        debtorName: debt.debtorName,
        amount: appliedAmount,
        paidAt: nowIso,
        method: safeMethod,
        note: `Paiement confirmé via webhook Mobile Money (${cleanRef})`.slice(0, 300),
        receiptNumber,
        transactionRef: cleanRef,
        createdBy: 'webhook_payment',
        createdAt: fieldValue.serverTimestamp(),
      });

      tx.update(debtDocRef, {
        remainingAmount: newRemaining,
        status: newStatus,
        updatedAt: fieldValue.serverTimestamp(),
      });

      if (excessAmount > 0) {
        tx.set(anomalyDocRef, {
          tenantId: params.tenantId,
          debtId: params.debtId,
          transactionRef: cleanRef,
          reason: 'Excédent de paiement reçu',
          receivedAmount,
          appliedAmount,
          excessAmount,
          recordedAt: nowIso,
          createdAt: fieldValue.serverTimestamp(),
        });
      }

      return {
        ok: true,
        idempotent: false,
        appliedAmount,
        excessAmount,
        remainingAmount: newRemaining,
        status: newStatus,
      };
    });

    return {
      ok: txResult.ok,
      verified: true,
      idempotent: txResult.idempotent,
      ...(txResult.reason ? { reason: txResult.reason } : {}),
      debtId: params.debtId,
      amount: txResult.appliedAmount,
      receivedAmount,
      excessAmount: txResult.excessAmount,
      ...(txResult.remainingAmount !== undefined ? { remainingAmount: txResult.remainingAmount } : {}),
      ...(txResult.status ? { status: txResult.status } : {}),
      method: safeMethod,
      transactionRef: cleanRef,
    };
  }

  // ==========================================================================
  // 1. Capacités serveur (sans jamais exposer les clés API)
  // ==========================================================================
  app.get('/api/config/capabilities', (_req, res) => {
    const secrets = getSecrets();
    const whatsappConfigured = Boolean(secrets.whatsappAccessToken && secrets.whatsappPhoneNumberId);
    const smsConfigured = Boolean(secrets.smsProviderUrl && secrets.smsApiKey);
    const paymentConfigured = Boolean(secrets.paymentProviderUrl && secrets.paymentApiKey);
    const emailConfigured = Boolean(secrets.emailProviderApiKey);

    res.json({
      whatsappConfigured,
      smsConfigured,
      paymentConfigured,
      emailConfigured,
      simulationMode: !whatsappConfigured && !smsConfigured,
      simulationRoutes: simRoutesEnabled,
      timezone: 'Africa/Douala',
    });
  });

  // ==========================================================================
  // 2. Facturation & Paiement d'abonnement SaaS
  // ==========================================================================
  app.post('/api/billing/checkout', requireAuth, uidRateLimiter, async (req, res) => {
    try {
      const { uid } = (req as AuthenticatedRequest).auth!;
      const { tenantId, planId } = req.body as { tenantId?: unknown; planId?: unknown };

      if (!isValidId(tenantId) || !isValidPlanId(planId) || planId === 'free') {
        res.status(400).json({ error: 'Sélectionnez un forfait payant valide (Starter, Pro ou Business).' });
        return;
      }

      await requireTenantOwner(uid, tenantId);

      const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
      if (!tenantSnap.exists) {
        res.status(404).json({ error: 'Entreprise introuvable.' });
        return;
      }

      const tenantData = tenantSnap.data() as { name: string; phone: string };
      const planDef = PLANS[planId];
      const amountFcfa = planDef.priceFcfa;
      const paymentRef = makeDocId('abo');

      const secrets = getSecrets();
      const paymentProvider = createPaymentProvider(secrets);
      const link = await paymentProvider.createPaymentLink({
        tenantId,
        paymentRef,
        amountFcfa,
        customerPhone: tenantData.phone,
        customerName: tenantData.name,
        description: `Abonnement PayReminder — ${planDef.name}`,
        metadata: {
          type: 'subscription',
          tenantId,
          paymentRef,
          planId,
        },
      });

      await db.doc(`tenants/${tenantId}/billing/${paymentRef}`).set({
        tenantId,
        planId,
        amountFcfa,
        status: 'pending',
        paymentRef,
        paymentUrl: link.paymentUrl,
        createdBy: uid,
        createdAt: fieldValue.serverTimestamp(),
        updatedAt: fieldValue.serverTimestamp(),
      });

      res.json({
        ok: true,
        paymentUrl: link.paymentUrl,
        paymentRef,
        amountFcfa,
        planId,
        simulated: link.simulated,
      });
    } catch (error) {
      handleRouteError(res, error, 'POST /api/billing/checkout');
    }
  });

  app.post('/api/billing/change-plan', requireNonProduction, requireAuth, uidRateLimiter, async (req, res) => {
    try {
      const { uid } = (req as AuthenticatedRequest).auth!;
      const { tenantId, planId } = req.body as { tenantId?: unknown; planId?: unknown };

      if (!isValidId(tenantId) || !isValidPlanId(planId)) {
        res.status(400).json({ error: 'Paramètres de forfait invalides.' });
        return;
      }

      await requireTenantOwner(uid, tenantId);

      const secrets = getSecrets();
      if (!secrets.allowPlanChangeWithoutPayment) {
        res.status(402).json({ error: "Le paiement de l'abonnement est requis." });
        return;
      }

      const planDef = PLANS[planId];
      const nowMs = nowFn();
      const nowIso = new Date(nowMs).toISOString();

      await db.doc(`tenants/${tenantId}`).update({
        plan: planId,
        maxDebtors: planDef.maxDebtors,
        maxRemindersPerMonth: planDef.maxRemindersPerMonth,
        maxRemindersPerDay: planDef.maxRemindersPerDay,
        subscriptionDate: nowIso,
        planStatus: 'active',
        updatedAt: fieldValue.serverTimestamp(),
      });

      await writeAuditLog(
        db,
        fieldValue,
        {
          tenantId,
          action: 'plan_change',
          actorUid: uid,
          targetId: planId,
          summary: `Changement manuel vers le forfait ${planDef.name}`,
          metadata: { planId },
        },
        nowMs
      );

      res.json({
        ok: true,
        plan: planId,
        maxDebtors: planDef.maxDebtors,
        maxRemindersPerMonth: planDef.maxRemindersPerMonth,
        maxRemindersPerDay: planDef.maxRemindersPerDay,
      });
    } catch (error) {
      handleRouteError(res, error, 'POST /api/billing/change-plan');
    }
  });

  // ==========================================================================
  // 3. Effacement complet RGPD d'un débiteur et de son historique (Owner-only)
  // ==========================================================================
  app.post('/api/debtors/erase', requireAuth, uidRateLimiter, async (req, res) => {
    try {
      const { uid } = (req as AuthenticatedRequest).auth!;
      const { tenantId, debtorId } = req.body as { tenantId?: unknown; debtorId?: unknown };

      if (!isValidId(tenantId) || !isValidId(debtorId)) {
        res.status(400).json({ error: 'Identifiants entreprise ou débiteur invalides.' });
        return;
      }

      await requireTenantOwner(uid, tenantId);

      const debtorRef = db.doc(`tenants/${tenantId}/debtors/${debtorId}`);
      const debtorSnap = await debtorRef.get();
      if (!debtorSnap.exists) {
        res.status(404).json({ error: 'Débiteur introuvable.' });
        return;
      }

      const [debtsSnap, paymentsSnap, remindersSnap, logsSnap] = await Promise.all([
        db.collection(`tenants/${tenantId}/debts`).where('debtorId', '==', debtorId).get(),
        db.collection(`tenants/${tenantId}/payments`).where('debtorId', '==', debtorId).get(),
        db.collection(`tenants/${tenantId}/reminders`).where('debtorId', '==', debtorId).get(),
        db.collection(`tenants/${tenantId}/messageLogs`).where('debtorId', '==', debtorId).get(),
      ]);

      const refsToDelete = [
        { path: debtorRef.path, ref: debtorRef },
        ...debtsSnap.docs.map((d) => ({ path: d.ref.path, ref: d.ref })),
        ...paymentsSnap.docs.map((d) => ({ path: d.ref.path, ref: d.ref })),
        ...remindersSnap.docs.map((d) => ({ path: d.ref.path, ref: d.ref })),
        ...logsSnap.docs.map((d) => ({ path: d.ref.path, ref: d.ref })),
      ];

      await deleteRefsInBatches(db, refsToDelete);

      const counts = {
        deletedDebtor: 1,
        deletedDebts: debtsSnap.size,
        deletedPayments: paymentsSnap.size,
        deletedReminders: remindersSnap.size,
        deletedMessageLogs: logsSnap.size,
      };

      await writeAuditLog(
        db,
        fieldValue,
        {
          tenantId,
          action: 'debtor_erase',
          actorUid: uid,
          targetId: debtorId,
          summary: `Effacement complet du débiteur (${counts.deletedDebts} dette(s), ${counts.deletedPayments} paiement(s), ${counts.deletedReminders} relance(s), ${counts.deletedMessageLogs} log(s))`,
          metadata: counts,
        },
        nowFn()
      );

      log.info({ tenantId, debtorId, ...counts }, 'Debtor data erased');

      res.json({
        ok: true,
        debtorId,
        ...counts,
      });
    } catch (error) {
      handleRouteError(res, error, 'POST /api/debtors/erase');
    }
  });

  // ==========================================================================
  // 4. Vérification téléphone du propriétaire (aucune PII dans les logs)
  // ==========================================================================
  app.post('/api/security/send-phone-code', requireAuth, phoneCodeRateLimiter, async (req, res) => {
    try {
      const { uid } = (req as AuthenticatedRequest).auth!;
      const { tenantId } = req.body as { tenantId?: unknown };

      if (!isValidId(tenantId)) {
        res.status(400).json({ error: 'Identifiant entreprise invalide.' });
        return;
      }

      await requireTenantOwner(uid, tenantId);

      const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
      if (!tenantSnap.exists) {
        res.status(404).json({ error: 'Entreprise introuvable.' });
        return;
      }
      const tenantData = tenantSnap.data() as { phone?: string };
      const phone = tenantData.phone || '';
      if (!/^\+[1-9][0-9]{7,15}$/.test(phone)) {
        res.status(400).json({ error: 'Numéro de téléphone de l’entreprise invalide (+237...).' });
        return;
      }

      const code = crypto.randomInt(100000, 1000000).toString();
      const salt = crypto.randomBytes(16).toString('hex');
      const codeHash = hashPhoneCode(salt, code);
      const expiresAt = new Date(nowFn() + 10 * 60 * 1000).toISOString();

      await db.doc(`tenantSecurity/${tenantId}`).set(
        {
          tenantId,
          phoneHash: codeHash,
          phoneSalt: salt,
          phoneCodeExpiresAt: expiresAt,
          phoneVerifyAttempts: 0,
          phoneTarget: phone,
          updatedAt: fieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const secrets = getSecrets();
      const smsProvider = createSmsProvider(secrets);
      const sendRes = await smsProvider.sendSms({
        to: phone,
        message: `PayReminder : votre code de vérification est ${code} (valable 10 minutes).`,
      });

      if (!sendRes.success) {
        res.status(502).json({ error: 'Échec de l’envoi du SMS de vérification.' });
        return;
      }

      if (sendRes.simulated) {
        log.info({ tenantId, simulated: true }, 'OTP verification code generated');
      }

      res.json({
        ok: true,
        simulated: sendRes.simulated,
        phone,
        expiresAt,
        ...(!isProd && sendRes.simulated ? { devCode: code } : {}),
      });
    } catch (error) {
      handleRouteError(res, error, 'POST /api/security/send-phone-code');
    }
  });

  app.post('/api/security/verify-phone-code', requireAuth, uidRateLimiter, async (req, res) => {
    try {
      const { uid } = (req as AuthenticatedRequest).auth!;
      const { tenantId, code } = req.body as { tenantId?: unknown; code?: unknown };

      if (!isValidId(tenantId) || typeof code !== 'string' || !/^[0-9]{6}$/.test(code.trim())) {
        res.status(400).json({ error: 'Code à 6 chiffres invalide.' });
        return;
      }

      await requireTenantOwner(uid, tenantId);

      const cleanCode = code.trim();
      const securityRef = db.doc(`tenantSecurity/${tenantId}`);
      const nowMs = nowFn();

      const verificationResult = await db.runTransaction(async (tx) => {
        const snap = await tx.get(securityRef);
        if (!snap.exists) {
          throw new HttpError(400, 'Aucun code actif. Demandez un nouveau code.');
        }

        const sec = snap.data() as {
          phoneHash?: string;
          phoneSalt?: string;
          phoneCodeExpiresAt?: string;
          phoneVerifyAttempts?: number;
        };

        if (!sec.phoneHash || !sec.phoneSalt || !sec.phoneCodeExpiresAt) {
          throw new HttpError(400, 'Aucun code actif. Demandez un nouveau code.');
        }

        const attempts = Number(sec.phoneVerifyAttempts || 0);
        if (attempts >= 5) {
          throw new HttpError(429, 'Nombre maximal de tentatives atteint (5). Demandez un nouveau code.');
        }

        if (nowMs > Date.parse(sec.phoneCodeExpiresAt)) {
          throw new HttpError(400, 'Code expiré (10 minutes). Demandez un nouveau code.');
        }

        const candidateHash = hashPhoneCode(sec.phoneSalt, cleanCode);
        if (!constantTimeEquals(candidateHash, sec.phoneHash)) {
          tx.set(
            securityRef,
            {
              phoneVerifyAttempts: attempts + 1,
              updatedAt: fieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          return { matched: false, remainingAttempts: Math.max(0, 5 - (attempts + 1)) };
        }

        tx.set(
          securityRef,
          {
            phoneVerified: true,
            phoneVerifiedAt: new Date(nowMs).toISOString(),
            phoneHash: fieldValue.delete(),
            phoneSalt: fieldValue.delete(),
            phoneCodeExpiresAt: fieldValue.delete(),
            phoneVerifyAttempts: 0,
            updatedAt: fieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return { matched: true, remainingAttempts: 5 };
      });

      if (!verificationResult.matched) {
        res.status(400).json({
          error: `Code incorrect (${verificationResult.remainingAttempts} tentative(s) restante(s)).`,
        });
        return;
      }

      await writeAuditLog(
        db,
        fieldValue,
        {
          tenantId,
          action: 'phone_verified',
          actorUid: uid,
          summary: 'Numéro de téléphone du propriétaire vérifié par code SMS',
        },
        nowMs
      );

      res.json({ ok: true, phoneVerified: true });
    } catch (error) {
      handleRouteError(res, error, 'POST /api/security/verify-phone-code');
    }
  });

  // ==========================================================================
  // 5. Envoi manuel via le service partagé sendReminderForDebt
  // ==========================================================================
  app.post('/api/reminders/dispatch', requireAuth, uidRateLimiter, async (req, res) => {
    try {
      const { uid } = (req as AuthenticatedRequest).auth!;
      const { tenantId, debtId, channel, tone } = req.body as {
        tenantId?: unknown;
        debtId?: unknown;
        channel?: unknown;
        tone?: unknown;
      };

      if (!isValidId(tenantId) || !isValidId(debtId)) {
        res.status(400).json({ error: 'Identifiants entreprise ou dette invalides.' });
        return;
      }

      if (channel !== undefined && channel !== 'whatsapp' && channel !== 'sms') {
        res.status(400).json({ error: 'Canal de relance invalide.' });
        return;
      }

      if (tone !== undefined && tone !== 'amical' && tone !== 'ferme' && tone !== 'dernier_avis') {
        res.status(400).json({ error: 'Ton de relance invalide.' });
        return;
      }

      await requireTenantMember(uid, tenantId);

      const result = await sendReminderForDebt(
        {
          tenantId,
          debtId,
          channel: channel as Channel | undefined,
          tone: tone as Tone | undefined,
          trigger: 'manual',
          actorUid: uid,
        },
        {
          db,
          fieldValue,
          now: nowFn,
          getSecrets,
          providers: {
            createPaymentProvider,
            createSmsProvider,
            sendWhatsAppTemplateMessage,
          },
          logger: log,
        }
      );

      res.json(result);
    } catch (error) {
      handleRouteError(res, error, 'POST /api/reminders/dispatch');
    }
  });

  // ==========================================================================
  // 6. Route planifiée de relances automatiques (CRON_SECRET)
  // ==========================================================================
  app.post('/api/cron/run-reminders', requireCronSecret, async (_req, res) => {
    try {
      const startedAt = nowFn();
      const nowDate = new Date(startedAt);
      const timeBudgetMs = 50_000;
      const slotKey = getQuarterHourSlotKeyDouala(nowDate);
      const lockRef = db.doc(`cronLocks/run-reminders-${slotKey}`);

      const alreadyLocked = await db.runTransaction(async (tx) => {
        const snap = await tx.get(lockRef);
        if (snap.exists) return true;
        tx.set(lockRef, {
          job: 'run-reminders',
          slotKey,
          createdAt: fieldValue.serverTimestamp(),
        });
        return false;
      });

      if (alreadyLocked) {
        res.json({ ok: true, skipped: true, slotKey });
        return;
      }

      const todayDouala = getTodayDoualaDate(nowDate);
      const currentHour = getCurrentDoualaHour(nowDate);

      const tenantsSnap = await db.collection('tenants').get();
      let processed = 0;
      let sent = 0;
      let failed = 0;
      let stoppedEarly = false;
      const skipped: Record<string, number> = {};

      const addSkip = (reason: string, count = 1) => {
        skipped[reason] = (skipped[reason] || 0) + count;
      };

      await runWithConcurrency(tenantsSnap.docs, 5, async (tenantDoc) => {
        if (nowFn() - startedAt >= timeBudgetMs) {
          stoppedEarly = true;
          return;
        }

        const tenantId = tenantDoc.id;
        const tenantData = (tenantDoc.data() || {}) as {
          plan?: string;
          quietHoursStart?: number;
          quietHoursEnd?: number;
          autoEscalate?: boolean;
        };

        const [rulesSnap, debtsSnap] = await Promise.all([
          db.collection(`tenants/${tenantId}/reminderRules`).where('enabled', '==', true).get(),
          db.collection(`tenants/${tenantId}/debts`).get(),
        ]);

        const rules = rulesSnap.docs.map(
          (d) =>
            d.data() as {
              offsetDays: number;
              channel: Channel;
              tone: Tone;
              allowedStartHour: number;
              allowedEndHour: number;
              maxReminders: number;
              enabled: boolean;
            }
        );

        const activeDebts = debtsSnap.docs.filter((d) => {
          const data = (d.data() || {}) as { status?: string; remainingAmount?: number };
          return (
            data.status !== 'payee' &&
            data.status !== 'annulee' &&
            Number(data.remainingAmount || 0) > 0
          );
        });

        if (activeDebts.length === 0 || rules.length === 0) {
          return;
        }

        const quietStart = Number(tenantData.quietHoursStart ?? 20);
        const quietEnd = Number(tenantData.quietHoursEnd ?? 7);
        if (isWithinQuietHours(currentHour, quietStart, quietEnd)) {
          addSkip('quiet_hours', activeDebts.length);
          return;
        }

        const planKey: PlanId = isValidPlanId(tenantData.plan) ? tenantData.plan : 'free';
        const whatsappAllowed = PLANS[planKey].whatsappEnabled;

        for (const debtDoc of activeDebts) {
          if (nowFn() - startedAt >= timeBudgetMs) {
            stoppedEarly = true;
            break;
          }

          const debtData = (debtDoc.data() || {}) as {
            dueDate: string;
            reminderCount?: number;
          };

          const daysOffset = getDaysOverdue(debtData.dueDate, todayDouala);
          const matchingRule = rules.find((r) => Number(r.offsetDays) === daysOffset);
          if (!matchingRule) {
            continue;
          }

          if (Number(debtData.reminderCount || 0) >= Number(matchingRule.maxReminders || 4)) {
            addSkip('rule_max_reminders');
            continue;
          }

          const startHour = Number(matchingRule.allowedStartHour ?? 8);
          const endHour = Number(matchingRule.allowedEndHour ?? 19);
          if (currentHour < startHour || currentHour >= endHour) {
            addSkip('outside_rule_hours');
            continue;
          }

          const effectiveTone: Tone = tenantData.autoEscalate
            ? pickEscalatedTone(daysOffset, true)
            : matchingRule.tone;
          const effectiveChannel: Channel = whatsappAllowed ? matchingRule.channel : 'sms';

          processed += 1;
          try {
            await sendReminderForDebt(
              {
                tenantId,
                debtId: debtDoc.id,
                channel: effectiveChannel,
                tone: effectiveTone,
                trigger: 'cron',
              },
              {
                db,
                fieldValue,
                now: nowFn,
                getSecrets,
                providers: {
                  createPaymentProvider,
                  createSmsProvider,
                  sendWhatsAppTemplateMessage,
                },
                logger: log,
              }
            );
            sent += 1;
          } catch (err) {
            if (err instanceof HttpError && [400, 403, 404, 409, 429].includes(err.statusCode)) {
              addSkip(err.skipReason || 'blocked');
            } else {
              failed += 1;
            }
          }
        }
      });

      log.info({ slotKey, processed, sent, failed, stoppedEarly }, 'CRON run-reminders completed');

      res.json({
        ok: true,
        slotKey,
        processed,
        sent,
        skipped,
        failed,
        stoppedEarly,
      });
    } catch (error) {
      handleRouteError(res, error, 'POST /api/cron/run-reminders');
    }
  });

  // ==========================================================================
  // 7. Cron cycle de vie des abonnements (grâce 3j -> free + emails)
  // ==========================================================================
  app.post('/api/cron/subscriptions', requireCronSecret, async (_req, res) => {
    try {
      const secrets = getSecrets();
      const nowMs = nowFn();
      const tenantsSnap = await db.collection('tenants').get();

      let checked = 0;
      let remindersSent = 0;
      let movedToGrace = 0;
      let downgradedToFree = 0;

      const sendLifecycleEmail = async (params: {
        to: string;
        subject: string;
        html: string;
        tenantId: string;
        eventTag: string;
      }): Promise<boolean> => {
        if (!secrets.emailProviderApiKey) {
          log.info({ tenantId: params.tenantId, eventTag: params.eventTag }, 'Simulated subscription lifecycle email');
          return true;
        }
        const resp = await sendEmail({
          to: params.to,
          subject: params.subject,
          html: params.html,
          from: secrets.emailFromAddress,
          apiKey: secrets.emailProviderApiKey,
        });
        return resp.ok;
      };

      for (const tenantDoc of tenantsSnap.docs) {
        const tenant = (tenantDoc.data() || {}) as {
          name?: string;
          email?: string;
          plan?: string;
          planExpiresAt?: string;
          planStatus?: string;
        };

        if (!tenant.planExpiresAt || tenant.plan === 'free') continue;
        const expiresMs = Date.parse(tenant.planExpiresAt);
        if (!Number.isFinite(expiresMs)) continue;

        checked += 1;
        const msRemaining = expiresMs - nowMs;
        const daysRemaining = msRemaining / (24 * 60 * 60 * 1000);
        const securityRef = db.doc(`tenantSecurity/${tenantDoc.id}`);
        const secSnap = await securityRef.get();
        const secData = secSnap.exists
          ? (secSnap.data() as { expiryReminder5dFor?: string; expiryNoticeFor?: string })
          : {};

        const safeName = escapeHtml(tenant.name || 'Votre entreprise');
        const safePlan = escapeHtml(
          isValidPlanId(tenant.plan) ? PLANS[tenant.plan].name : tenant.plan || 'PayReminder'
        );
        const safeExpDate = escapeHtml(tenant.planExpiresAt.slice(0, 10));

        if (daysRemaining > 0 && daysRemaining <= 5 && secData.expiryReminder5dFor !== tenant.planExpiresAt) {
          if (tenant.email) {
            const ok = await sendLifecycleEmail({
              to: tenant.email,
              subject: `PayReminder — Votre forfait ${safePlan} expire bientôt`,
              html: `<p>Bonjour ${safeName},</p><p>Votre abonnement PayReminder (${safePlan}) arrive à expiration le ${safeExpDate}. Renouvelez votre forfait depuis la page Abonnement pour éviter toute interruption.</p>`,
              tenantId: tenantDoc.id,
              eventTag: 'expiry_reminder_5d',
            });
            if (ok) {
              remindersSent += 1;
              await securityRef.set(
                { expiryReminder5dFor: tenant.planExpiresAt, updatedAt: fieldValue.serverTimestamp() },
                { merge: true }
              );
            }
          }
          continue;
        }

        if (msRemaining <= 0 && msRemaining > -3 * 24 * 60 * 60 * 1000) {
          if (tenant.planStatus !== 'grace') {
            await tenantDoc.ref.update({
              planStatus: 'grace',
              updatedAt: fieldValue.serverTimestamp(),
            });
            movedToGrace += 1;
          }

          if (secData.expiryNoticeFor !== tenant.planExpiresAt && tenant.email) {
            const ok = await sendLifecycleEmail({
              to: tenant.email,
              subject: `PayReminder — Abonnement ${safePlan} expiré (période de grâce 3 jours)`,
              html: `<p>Bonjour ${safeName},</p><p>Votre abonnement PayReminder (${safePlan}) a expiré le ${safeExpDate}. Vous bénéficiez d’une période de grâce de 3 jours avant le retour au forfait Gratuit.</p>`,
              tenantId: tenantDoc.id,
              eventTag: 'expiry_grace_notice',
            });
            if (ok) {
              remindersSent += 1;
              await securityRef.set(
                { expiryNoticeFor: tenant.planExpiresAt, updatedAt: fieldValue.serverTimestamp() },
                { merge: true }
              );
            }
          }
          continue;
        }

        if (msRemaining <= -3 * 24 * 60 * 60 * 1000) {
          await tenantDoc.ref.update({
            plan: 'free',
            maxDebtors: PLANS.free.maxDebtors,
            maxRemindersPerMonth: PLANS.free.maxRemindersPerMonth,
            maxRemindersPerDay: PLANS.free.maxRemindersPerDay,
            planStatus: 'expired',
            updatedAt: fieldValue.serverTimestamp(),
          });
          downgradedToFree += 1;
        }
      }

      res.json({
        ok: true,
        simulated: !secrets.emailProviderApiKey,
        checked,
        remindersSent,
        movedToGrace,
        downgradedToFree,
      });
    } catch (error) {
      handleRouteError(res, error, 'POST /api/cron/subscriptions');
    }
  });

  // ==========================================================================
  // 8. Génération de lien Mobile Money basée sur Firestore
  // ==========================================================================
  app.post('/api/payments/create-link', requireAuth, uidRateLimiter, async (req, res) => {
    try {
      const { uid } = (req as AuthenticatedRequest).auth!;
      const { tenantId, debtId } = req.body as { tenantId?: unknown; debtId?: unknown };

      if (!isValidId(tenantId) || !isValidId(debtId)) {
        res.status(400).json({ error: 'Identifiants entreprise ou dette invalides.' });
        return;
      }

      await requireTenantMember(uid, tenantId);

      const debtRef = db.doc(`tenants/${tenantId}/debts/${debtId}`);
      const debtSnap = await debtRef.get();
      if (!debtSnap.exists) {
        res.status(404).json({ error: 'Dette introuvable.' });
        return;
      }

      const debtData = debtSnap.data() as {
        debtorId: string;
        remainingAmount: number;
        status: string;
        description?: string;
      };

      if (debtData.status === 'payee' || debtData.status === 'annulee' || Number(debtData.remainingAmount) <= 0) {
        res.status(409).json({ error: 'Impossible de créer un lien : dette déjà soldée ou annulée.' });
        return;
      }

      const debtorSnap = await db.doc(`tenants/${tenantId}/debtors/${debtData.debtorId}`).get();
      if (!debtorSnap.exists) {
        res.status(404).json({ error: 'Débiteur introuvable.' });
        return;
      }
      const debtorData = debtorSnap.data() as { name: string; phone: string };

      const secrets = getSecrets();
      const provider = createPaymentProvider(secrets);
      const link = await provider.createPaymentLink({
        tenantId,
        debtId,
        amountFcfa: Number(debtData.remainingAmount),
        customerPhone: debtorData.phone,
        customerName: debtorData.name,
        description: debtData.description || 'Règlement créance',
        metadata: {
          type: 'debt',
          tenantId,
          debtId,
        },
      });

      await debtRef.update({
        paymentLink: link.paymentUrl,
        updatedAt: fieldValue.serverTimestamp(),
      });

      res.json(link);
    } catch (error) {
      handleRouteError(res, error, 'POST /api/payments/create-link');
    }
  });

  // ==========================================================================
  // 9. Routes de simulation authentifiées (404 en production)
  // ==========================================================================
  app.post('/api/simulate/whatsapp-inbound', requireSimulationRoutesEnabled, requireAuth, uidRateLimiter, async (req, res) => {
    try {
      const { uid } = (req as AuthenticatedRequest).auth!;
      const { tenantId, fromPhone, messageText } = req.body as {
        tenantId?: unknown;
        fromPhone?: unknown;
        messageText?: unknown;
      };

      if (!isValidId(tenantId) || typeof messageText !== 'string' || !messageText.trim()) {
        res.status(400).json({ error: 'Paramètres de simulation WhatsApp invalides.' });
        return;
      }

      await requireTenantMember(uid, tenantId);

      const result = await processInboundWhatsapp({
        tenantId,
        fromPhone: typeof fromPhone === 'string' ? fromPhone : '',
        messageText: messageText.trim(),
        providerMessageId: `in_sim_${nowFn()}`,
      });

      res.json(result);
    } catch (error) {
      handleRouteError(res, error, 'POST /api/simulate/whatsapp-inbound');
    }
  });

  app.post('/api/simulate/payment', requireSimulationRoutesEnabled, requireAuth, uidRateLimiter, async (req, res) => {
    try {
      const { uid } = (req as AuthenticatedRequest).auth!;
      const { tenantId, debtId, amount, method, transactionRef } = req.body as {
        tenantId?: unknown;
        debtId?: unknown;
        amount?: unknown;
        method?: unknown;
        transactionRef?: unknown;
      };

      if (!isValidId(tenantId) || !isValidId(debtId)) {
        res.status(400).json({ error: 'Identifiants entreprise ou dette invalides.' });
        return;
      }

      const numericAmount = Math.round(Number(amount));
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        res.status(400).json({ error: 'Montant de paiement invalide.' });
        return;
      }

      await requireTenantMember(uid, tenantId);

      const ref =
        typeof transactionRef === 'string' && transactionRef.trim().length >= 3
          ? transactionRef.trim()
          : `SIM-${debtId.slice(-6).toUpperCase()}-${nowFn()}`;

      const result = await processPaymentConfirmation({
        tenantId,
        debtId,
        amount: numericAmount,
        method: typeof method === 'string' ? method : 'mtn_momo',
        transactionRef: ref,
      });

      res.json(result);
    } catch (error) {
      handleRouteError(res, error, 'POST /api/simulate/payment');
    }
  });

  app.post('/api/simulate/subscription-payment', requireSimulationRoutesEnabled, requireAuth, uidRateLimiter, async (req, res) => {
    try {
      const { uid } = (req as AuthenticatedRequest).auth!;
      const { tenantId, paymentRef, method } = req.body as {
        tenantId?: unknown;
        paymentRef?: unknown;
        method?: unknown;
      };

      if (!isValidId(tenantId) || !isValidId(paymentRef)) {
        res.status(400).json({ error: 'Identifiants entreprise ou référence de paiement invalides.' });
        return;
      }

      await requireTenantOwner(uid, tenantId);

      const billingSnap = await db.doc(`tenants/${tenantId}/billing/${paymentRef}`).get();
      if (!billingSnap.exists) {
        res.status(404).json({ error: 'Demande de paiement abonnement introuvable.' });
        return;
      }

      const billingData = billingSnap.data() as { amountFcfa?: number };
      const result = await processSubscriptionPaymentConfirmation(
        {
          tenantId,
          paymentRef,
          amount: Number(billingData.amountFcfa || 0),
          method: typeof method === 'string' ? method : 'mtn_momo',
          transactionRef: `SIM-ABO-${paymentRef.slice(-6).toUpperCase()}-${nowFn()}`,
        },
        { db, fieldValue, now: nowFn }
      );

      res.json(result);
    } catch (error) {
      handleRouteError(res, error, 'POST /api/simulate/subscription-payment');
    }
  });

  // ==========================================================================
  // 10. Webhooks externes signés HMAC-SHA256
  // ==========================================================================
  app.get('/api/webhooks/whatsapp', (req, res) => {
    const secrets = getSecrets();
    const mode = typeof req.query['hub.mode'] === 'string' ? req.query['hub.mode'] : '';
    const token = typeof req.query['hub.verify_token'] === 'string' ? req.query['hub.verify_token'] : '';
    const challenge = typeof req.query['hub.challenge'] === 'string' ? req.query['hub.challenge'] : '';

    if (
      mode === 'subscribe' &&
      secrets.whatsappWebhookVerifyToken &&
      constantTimeEquals(token, secrets.whatsappWebhookVerifyToken)
    ) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('Jeton de vérification invalide');
  });

  app.post('/api/webhooks/whatsapp', async (req, res) => {
    try {
      const secrets = getSecrets();
      const rawBody = (req as AuthenticatedRequest).rawBody;
      const sigHeader = req.header('x-hub-signature-256');

      const sigCheck = verifyWebhookHmac({
        rawBody,
        signatureHeader: sigHeader,
        secret: secrets.whatsappAppSecret,
        secretEnvName: 'WHATSAPP_APP_SECRET',
        isProduction: isProd,
      });
      if (!sigCheck.ok) {
        res.status(401).json({ error: sigCheck.error });
        return;
      }

      const body = req.body as {
        fromPhone?: string;
        messageText?: string;
        entry?: Array<{
          changes?: Array<{
            value?: {
              statuses?: Array<{ id?: string; status?: 'sent' | 'delivered' | 'read' | 'failed' }>;
              messages?: Array<{
                id?: string;
                from?: string;
                text?: { body?: string };
              }>;
            };
          }>;
        }>;
      };

      const changeValue = body.entry?.[0]?.changes?.[0]?.value;

      if (changeValue?.statuses?.length) {
        const statusMap: Record<string, string> = {
          sent: 'envoyee',
          delivered: 'delivree',
          read: 'lue',
          failed: 'echouee',
        };
        for (const st of changeValue.statuses) {
          if (!st.id || !st.status) continue;
          const mapped = statusMap[st.status];
          if (!mapped) continue;

          const [logsSnap, remsSnap] = await Promise.all([
            db.collectionGroup('messageLogs').where('providerMessageId', '==', st.id).get(),
            db.collectionGroup('reminders').where('providerMessageId', '==', st.id).get(),
          ]);
          for (const docSnap of logsSnap.docs) {
            await docSnap.ref.update({ status: mapped });
          }
          for (const remSnap of remsSnap.docs) {
            await remSnap.ref.update({ status: mapped, updatedAt: fieldValue.serverTimestamp() });
          }
        }
      }

      const metaMsg = changeValue?.messages?.[0];
      const messageText = metaMsg?.text?.body || body.messageText;
      const rawFrom = metaMsg?.from || body.fromPhone || '';

      if (!messageText || typeof messageText !== 'string') {
        if (changeValue?.statuses?.length) {
          res.json({ ok: true, statusesProcessed: changeValue.statuses.length });
          return;
        }
        res.status(400).json({ error: 'messageText requis' });
        return;
      }

      const result = await processInboundWhatsapp({
        fromPhone: rawFrom,
        messageText,
        providerMessageId: metaMsg?.id,
      });

      res.json(result);
    } catch (error) {
      handleRouteError(res, error, 'POST /api/webhooks/whatsapp');
    }
  });

  app.post('/api/webhooks/payment', async (req, res) => {
    try {
      const secrets = getSecrets();
      const rawBody = (req as AuthenticatedRequest).rawBody;
      const sigHeader = req.header('x-payment-signature') || req.header('x-hub-signature-256');

      const sigCheck = verifyWebhookHmac({
        rawBody,
        signatureHeader: sigHeader,
        secret: secrets.paymentWebhookSecret,
        secretEnvName: 'PAYMENT_WEBHOOK_SECRET',
        isProduction: isProd,
      });
      if (!sigCheck.ok) {
        res.status(401).json({ error: sigCheck.error });
        return;
      }

      const { tenantId, debtId, amount, method, transactionRef, metadata } = req.body as {
        tenantId?: unknown;
        debtId?: unknown;
        amount?: unknown;
        method?: unknown;
        transactionRef?: unknown;
        metadata?: { type?: unknown; tenantId?: unknown; debtId?: unknown };
      };

      if (metadata?.type === 'subscription') {
        res.status(400).json({
          error: 'Les paiements d’abonnement doivent être envoyés sur /api/webhooks/subscription-payment.',
        });
        return;
      }

      const resolvedTenantId = tenantId ?? metadata?.tenantId;
      const resolvedDebtId = debtId ?? metadata?.debtId;
      if (!isValidId(resolvedTenantId) || !isValidId(resolvedDebtId)) {
        res.status(400).json({ error: 'Identifiants entreprise ou dette invalides dans le webhook paiement.' });
        return;
      }

      const numericAmount = Math.round(Number(amount));
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        res.status(400).json({ error: 'Montant de paiement invalide.' });
        return;
      }

      if (typeof transactionRef !== 'string' || transactionRef.trim().length < 3) {
        res.status(400).json({ error: 'Référence de transaction (transactionRef) requise.' });
        return;
      }

      const result = await processPaymentConfirmation({
        tenantId: resolvedTenantId,
        debtId: resolvedDebtId,
        amount: numericAmount,
        method: typeof method === 'string' ? method : 'mtn_momo',
        transactionRef: transactionRef.trim(),
      });

      res.status(200).json(result);
    } catch (error) {
      handleRouteError(res, error, 'POST /api/webhooks/payment');
    }
  });

  app.post('/api/webhooks/subscription-payment', async (req, res) => {
    try {
      const secrets = getSecrets();
      const rawBody = (req as AuthenticatedRequest).rawBody;
      const sigHeader = req.header('x-payment-signature') || req.header('x-hub-signature-256');

      const sigCheck = verifyWebhookHmac({
        rawBody,
        signatureHeader: sigHeader,
        secret: secrets.paymentWebhookSecret,
        secretEnvName: 'PAYMENT_WEBHOOK_SECRET',
        isProduction: isProd,
      });
      if (!sigCheck.ok) {
        res.status(401).json({ error: sigCheck.error });
        return;
      }

      const { tenantId, paymentRef, amount, method, transactionRef, metadata } = req.body as {
        tenantId?: unknown;
        paymentRef?: unknown;
        amount?: unknown;
        method?: unknown;
        transactionRef?: unknown;
        metadata?: { type?: unknown; tenantId?: unknown; paymentRef?: unknown };
      };

      if (metadata?.type === 'debt') {
        res.status(400).json({
          error: 'Les paiements de créances clients doivent être envoyés sur /api/webhooks/payment.',
        });
        return;
      }

      const resolvedTenantId = tenantId ?? metadata?.tenantId;
      const resolvedPaymentRef = paymentRef ?? metadata?.paymentRef;
      if (!isValidId(resolvedTenantId) || !isValidId(resolvedPaymentRef)) {
        res.status(400).json({ error: 'Identifiants entreprise ou référence abonnement invalides.' });
        return;
      }

      const numericAmount = Math.round(Number(amount));
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        res.status(400).json({ error: 'Montant de paiement invalide.' });
        return;
      }

      if (typeof transactionRef !== 'string' || transactionRef.trim().length < 3) {
        res.status(400).json({ error: 'Référence de transaction (transactionRef) requise.' });
        return;
      }

      const result = await processSubscriptionPaymentConfirmation(
        {
          tenantId: resolvedTenantId,
          paymentRef: resolvedPaymentRef,
          amount: numericAmount,
          method: typeof method === 'string' ? method : 'mtn_momo',
          transactionRef: transactionRef.trim(),
        },
        { db, fieldValue, now: nowFn }
      );

      res.status(200).json(result);
    } catch (error) {
      handleRouteError(res, error, 'POST /api/webhooks/subscription-payment');
    }
  });

  // ==========================================================================
  // 11. Rapports CRON + Route utilisateur (HTML échappé contre XSS)
  // ==========================================================================
  app.post('/api/reports/send-monthly', requireCronSecret, async (req, res) => {
    try {
      const secrets = getSecrets();
      const nowDate = new Date(nowFn());
      const monthKey =
        typeof req.body?.monthKey === 'string' && /^[0-9]{4}-[0-9]{2}$/.test(req.body.monthKey)
          ? (req.body.monthKey as string)
          : getCurrentDoualaMonth(nowDate);

      const tenantsSnap = await db
        .collection('tenants')
        .where('plan', 'in', ['pro', 'business'])
        .get();

      const d = new Date(`${monthKey}-15T12:00:00Z`);
      const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(d);

      let sentCount = 0;
      let simulatedCount = 0;

      for (const tenantDoc of tenantsSnap.docs) {
        const t = tenantDoc.data() as { name: string; email: string };
        const [debtsSnap, paymentsSnap] = await Promise.all([
          db.collection(`tenants/${tenantDoc.id}/debts`).get(),
          db.collection(`tenants/${tenantDoc.id}/payments`).get(),
        ]);

        let totalDue = 0;
        let totalInitial = 0;
        let totalRecovered = 0;
        for (const docSnap of debtsSnap.docs) {
          const debt = docSnap.data() as { status: string; initialAmount: number; remainingAmount: number };
          if (debt.status === 'annulee') continue;
          totalInitial += Number(debt.initialAmount || 0);
          totalRecovered += Number(debt.initialAmount || 0) - Number(debt.remainingAmount || 0);
          if (debt.status !== 'payee') {
            totalDue += Number(debt.remainingAmount || 0);
          }
        }

        let collectedThisMonth = 0;
        for (const paySnap of paymentsSnap.docs) {
          const pay = paySnap.data() as { paidAt?: string; amount?: number };
          if (pay.paidAt?.slice(0, 7) === monthKey) {
            collectedThisMonth += Number(pay.amount || 0);
          }
        }

        const recoveryRate = totalInitial > 0 ? Number(((totalRecovered / totalInitial) * 100).toFixed(1)) : 0;

        if (!secrets.emailProviderApiKey) {
          simulatedCount += 1;
          continue;
        }

        const safeTenantName = escapeHtml(t.name);
        const safeMonthLabel = escapeHtml(monthLabel);

        const resp = await sendEmail({
          to: t.email,
          subject: `PayReminder — Rapport ${monthLabel} (${t.name})`,
          html: `<h2>Rapport mensuel ${safeTenantName}</h2><p>Période : ${safeMonthLabel}</p><p>Restant dû : ${escapeHtml(totalDue)} FCFA</p><p>Encaissé ce mois : ${escapeHtml(collectedThisMonth)} FCFA</p><p>Taux de récupération : ${escapeHtml(recoveryRate)}%</p>`,
          from: secrets.emailFromAddress,
          apiKey: secrets.emailProviderApiKey,
        });
        if (resp.ok) {
          sentCount += 1;
        }
      }

      res.json({
        ok: true,
        simulated: !secrets.emailProviderApiKey,
        processedTenants: tenantsSnap.size,
        sentCount,
        simulatedCount,
      });
    } catch (error) {
      handleRouteError(res, error, 'POST /api/reports/send-monthly');
    }
  });

  app.post('/api/reports/send-tenant-email', requireAuth, uidRateLimiter, async (req, res) => {
    try {
      const { uid } = (req as AuthenticatedRequest).auth!;
      const { tenantId, monthKey } = req.body as { tenantId?: unknown; monthKey?: unknown };

      if (!isValidId(tenantId)) {
        res.status(400).json({ error: 'Identifiant entreprise invalide.' });
        return;
      }

      await requireTenantMember(uid, tenantId);

      const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
      if (!tenantSnap.exists) {
        res.status(404).json({ error: 'Entreprise introuvable.' });
        return;
      }

      const tenant = tenantSnap.data() as { name: string; email: string; plan?: string };
      const planKey: PlanId = isValidPlanId(tenant.plan) ? tenant.plan : 'free';
      if (!PLANS[planKey].reportsEnabled) {
        res.status(403).json({ error: 'Les rapports avancés sont réservés aux forfaits Pro et Business.' });
        return;
      }

      const targetMonth =
        typeof monthKey === 'string' && /^[0-9]{4}-[0-9]{2}$/.test(monthKey)
          ? monthKey
          : getCurrentDoualaMonth(new Date(nowFn()));

      const [debtsSnap, paymentsSnap] = await Promise.all([
        db.collection(`tenants/${tenantId}/debts`).get(),
        db.collection(`tenants/${tenantId}/payments`).get(),
      ]);

      let totalDue = 0;
      let totalInitial = 0;
      let totalRecovered = 0;
      for (const docSnap of debtsSnap.docs) {
        const debt = docSnap.data() as { status: string; initialAmount: number; remainingAmount: number };
        if (debt.status === 'annulee') continue;
        totalInitial += Number(debt.initialAmount || 0);
        totalRecovered += Number(debt.initialAmount || 0) - Number(debt.remainingAmount || 0);
        if (debt.status !== 'payee') {
          totalDue += Number(debt.remainingAmount || 0);
        }
      }

      let collectedThisMonth = 0;
      for (const paySnap of paymentsSnap.docs) {
        const pay = paySnap.data() as { paidAt?: string; amount?: number };
        if (pay.paidAt?.slice(0, 7) === targetMonth) {
          collectedThisMonth += Number(pay.amount || 0);
        }
      }

      const recoveryRate = totalInitial > 0 ? Number(((totalRecovered / totalInitial) * 100).toFixed(1)) : 0;
      const d = new Date(`${targetMonth}-15T12:00:00Z`);
      const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(d);

      const secrets = getSecrets();
      if (!secrets.emailProviderApiKey) {
        res.json({
          ok: true,
          simulated: true,
          message: `Rapport mensuel simulé (aucune clé EMAIL_PROVIDER_API_KEY configurée).`,
        });
        return;
      }

      const safeTenantName = escapeHtml(tenant.name);
      const safeMonthLabel = escapeHtml(monthLabel);

      const resp = await sendEmail({
        to: tenant.email,
        subject: `PayReminder — Rapport ${monthLabel} (${tenant.name})`,
        html: `<h2>Rapport mensuel ${safeTenantName}</h2><p>Période : ${safeMonthLabel}</p><p>Restant dû : ${escapeHtml(totalDue)} FCFA</p><p>Encaissé ce mois : ${escapeHtml(collectedThisMonth)} FCFA</p><p>Taux de récupération : ${escapeHtml(recoveryRate)}%</p>`,
        from: secrets.emailFromAddress,
        apiKey: secrets.emailProviderApiKey,
      });

      if (!resp.ok) {
        log.error({ status: resp.status, bodyPreview: (resp.bodyText || '').slice(0, 200) }, 'EMAIL PROVIDER ERROR');
        res.status(502).json({ error: 'Échec de l’envoi du rapport par email.' });
        return;
      }

      res.json({
        ok: true,
        simulated: false,
        message: 'Rapport mensuel envoyé par email.',
      });
    } catch (error) {
      handleRouteError(res, error, 'POST /api/reports/send-tenant-email');
    }
  });

  return app;
}

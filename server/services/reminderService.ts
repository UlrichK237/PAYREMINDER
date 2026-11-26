import crypto from 'node:crypto';
import { adminDb, FieldValue } from '../firebaseAdmin';
import {
  getServerSecrets,
  hmacPhoneNumber,
  HttpError,
  isProduction as defaultIsProduction,
  resolveOtpPepper,
} from '../config';
import { logger as defaultLogger, type LoggerLike } from '../logger';
import type { AppProviders, DocRefLike, FieldValueLike, FirestoreLike, ServerSecrets } from '../types';
import type { Channel, PlanId, Tone } from '../../src/types/payreminder';
import { DEFAULT_TEMPLATES } from '../../src/utils/defaults';
import {
  getCurrentDoualaMonth,
  getDaysOverdue,
  getTodayDoualaDate,
  pickEscalatedTone,
  renderTemplateMessage,
} from '../../src/utils/formatters';
import { PLANS } from '../../src/utils/plans';
import { validateTemplateBody } from '../../src/utils/templateValidation';
import { writeAuditLog } from './auditService';
import { createPaymentProvider as defaultCreatePaymentProvider } from './payment';
import { createSmsProvider as defaultCreateSmsProvider } from './sms';
import { sendWhatsAppTemplateMessage as defaultSendWhatsApp } from './whatsapp';

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
export const SMS_STOP_NOTICE = 'Répondez STOP pour ne plus recevoir de messages.';
export const SMS_MAX_LENGTH = 480;

export interface SendReminderParams {
  tenantId: string;
  debtId: string;
  channel?: Channel;
  tone?: Tone;
  trigger: 'manual' | 'cron';
  actorUid?: string;
  ruleOffsetDays?: number;
}

export interface SendReminderResult {
  ok: true;
  reminderId: string;
  logId: string;
  channel: Channel;
  tone: Tone;
  usedFallback: boolean;
  status: 'simule' | 'envoyee';
  simulated: boolean;
  providerMessageId: string;
  paymentUrl: string;
  renderedContent: string;
  trigger: 'manual' | 'cron';
}

export interface ReminderServiceDeps {
  db?: FirestoreLike;
  fieldValue?: FieldValueLike;
  now?: () => number;
  getSecrets?: () => ServerSecrets;
  isProduction?: boolean;
  providers?: AppProviders;
  logger?: LoggerLike;
}

function isValidPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && Object.hasOwn(PLANS, value);
}

function makeDocId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function stripAccentsLower(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Ajoute la mention STOP obligatoire à la fin d'un SMS ou texte de repli
 * si elle n'est pas déjà présente, tout en respectant la limite de longueur (480 car.).
 */
export function appendSmsStopNotice(message: string, maxLength = SMS_MAX_LENGTH): string {
  const clean = message.trim();
  const normalized = stripAccentsLower(clean);
  const alreadyHasStop =
    normalized.includes('repondez stop') || normalized.includes('stop pour ne plus recevoir');

  if (alreadyHasStop) {
    return clean.length <= maxLength ? clean : clean.slice(0, maxLength);
  }

  const suffix = ` ${SMS_STOP_NOTICE}`;
  if (clean.length + suffix.length <= maxLength) {
    return `${clean}${suffix}`;
  }

  const available = Math.max(0, maxLength - suffix.length - 3);
  const truncated = clean.slice(0, available).trimEnd();
  return `${truncated}...${suffix}`.slice(0, maxLength);
}

async function rollbackReminderReservation(params: {
  db: FirestoreLike;
  fieldValue: FieldValueLike;
  tenantRef: DocRefLike;
  securityRef: DocRefLike;
  debtRef: DocRefLike;
  sendStateRef: DocRefLike;
  currentMonth: string;
  todayDouala: string;
  reservedNowMs: number;
  reservedNowIso: string;
  previousLastReminderAt?: string;
  logger: LoggerLike;
}): Promise<void> {
  try {
    await params.db.runTransaction(async (tx) => {
      const [tSnap, sSnap, dSnap, ssSnap] = await Promise.all([
        tx.get(params.tenantRef),
        tx.get(params.securityRef),
        tx.get(params.debtRef),
        tx.get(params.sendStateRef),
      ]);

      if (tSnap.exists) {
        const tData = tSnap.data() as { remindersUsedThisMonth?: number; quotaResetMonth?: string };
        if (tData.quotaResetMonth === params.currentMonth) {
          const nextMonthly = Math.max(0, Number(tData.remindersUsedThisMonth || 0) - 1);
          tx.update(params.tenantRef, {
            remindersUsedThisMonth: nextMonthly,
            updatedAt: params.fieldValue.serverTimestamp(),
          });
        }
      }

      if (sSnap.exists) {
        const sData = sSnap.data() as { dailyUsage?: { date?: string; count?: number } };
        if (sData.dailyUsage?.date === params.todayDouala) {
          const nextDaily = Math.max(0, Number(sData.dailyUsage.count || 0) - 1);
          tx.set(
            params.securityRef,
            {
              dailyUsage: { date: params.todayDouala, count: nextDaily },
              updatedAt: params.fieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }

      if (dSnap.exists) {
        const dData = dSnap.data() as { lastReminderAt?: string };
        if (dData.lastReminderAt === params.reservedNowIso) {
          tx.update(params.debtRef, {
            lastReminderAt: params.previousLastReminderAt ?? params.fieldValue.delete(),
            updatedAt: params.fieldValue.serverTimestamp(),
          });
        }
      }

      if (ssSnap.exists) {
        const ssData = ssSnap.data() as { sentTimestamps?: unknown[] };
        if (Array.isArray(ssData.sentTimestamps)) {
          const idx = ssData.sentTimestamps.findIndex((ts) => Number(ts) === params.reservedNowMs);
          if (idx !== -1) {
            const nextTimestamps = [...ssData.sentTimestamps];
            nextTimestamps.splice(idx, 1);
            tx.set(
              params.sendStateRef,
              {
                sentTimestamps: nextTimestamps,
                updatedAt: params.fieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        }
      }
    });
  } catch (refundError) {
    params.logger.error({ err: refundError }, 'QUOTA ROLLBACK FAILED');
  }
}

/**
 * Service unique d'envoi de relance (utilisé par /api/reminders/dispatch et /api/cron/run-reminders).
 */
export async function sendReminderForDebt(
  params: SendReminderParams,
  deps: ReminderServiceDeps = {}
): Promise<SendReminderResult> {
  const { tenantId, debtId, channel, tone, trigger } = params;
  const db: FirestoreLike = deps.db ?? (adminDb as unknown as FirestoreLike);
  const fieldValue: FieldValueLike = deps.fieldValue ?? (FieldValue as unknown as FieldValueLike);
  const nowFn = deps.now ?? (() => Date.now());
  const nowMs = nowFn();
  const nowDate = new Date(nowMs);
  const reservedNowIso = nowDate.toISOString();
  const secrets = (deps.getSecrets ?? getServerSecrets)();
  const isProd = deps.isProduction ?? defaultIsProduction;
  const log = deps.logger ?? defaultLogger;

  if (typeof tenantId !== 'string' || !VALID_ID_REGEX.test(tenantId)) {
    throw new HttpError(400, 'Identifiant entreprise invalide.', 'invalid_tenant_id');
  }
  if (typeof debtId !== 'string' || !VALID_ID_REGEX.test(debtId)) {
    throw new HttpError(400, 'Identifiant dette invalide.', 'invalid_debt_id');
  }
  if (channel !== undefined && channel !== 'whatsapp' && channel !== 'sms') {
    throw new HttpError(400, 'Canal de relance invalide.', 'invalid_channel');
  }
  if (tone !== undefined && tone !== 'amical' && tone !== 'ferme' && tone !== 'dernier_avis') {
    throw new HttpError(400, 'Ton de relance invalide.', 'invalid_tone');
  }

  const pepper = resolveOtpPepper(secrets, isProd);

  const tenantRef = db.doc(`tenants/${tenantId}`);
  const securityRef = db.doc(`tenantSecurity/${tenantId}`);
  const debtRef = db.doc(`tenants/${tenantId}/debts/${debtId}`);

  const [tenantSnap, debtSnap] = await Promise.all([tenantRef.get(), debtRef.get()]);
  if (!tenantSnap.exists) {
    throw new HttpError(404, 'Entreprise introuvable.', 'tenant_not_found');
  }
  if (!debtSnap.exists) {
    throw new HttpError(404, 'Dette introuvable pour cette entreprise.', 'debt_not_found');
  }

  const tenantData = tenantSnap.data() as {
    name: string;
    phone?: string;
    plan?: string;
    autoEscalate?: boolean;
    fallbackToSms?: boolean;
  };
  const debtData = debtSnap.data() as {
    debtorId: string;
    remainingAmount: number;
    dueDate: string;
    status: string;
    description?: string;
    lastReminderAt?: string;
    appliedRuleOffsets?: number[];
    ruleReminderCounts?: Record<string, number>;
  };

  if (debtData.status === 'payee' || debtData.status === 'annulee' || Number(debtData.remainingAmount) <= 0) {
    throw new HttpError(
      409,
      'Relance impossible : cette dette est déjà payée ou annulée.',
      'debt_settled_or_cancelled'
    );
  }

  const debtorSnap = await db.doc(`tenants/${tenantId}/debtors/${debtData.debtorId}`).get();
  if (!debtorSnap.exists) {
    throw new HttpError(404, 'Débiteur associé introuvable.', 'debtor_not_found');
  }

  const debtorData = debtorSnap.data() as {
    name: string;
    phone: string;
    preferredChannel?: Channel;
    optOut?: boolean;
  };

  if (debtorData.optOut === true) {
    throw new HttpError(
      409,
      `${debtorData.name} a demandé l’arrêt des messages (Opt-out actif).`,
      'opt_out'
    );
  }

  if (!debtorData.phone || !/^\+[1-9][0-9]{7,15}$/.test(debtorData.phone)) {
    throw new HttpError(409, 'Numéro de téléphone du débiteur invalide.', 'invalid_phone');
  }

  const phoneHash = hmacPhoneNumber(pepper, debtorData.phone);
  const suppressionRef = db.doc(`tenants/${tenantId}/suppressions/${phoneHash}`);
  const sendStateRef = db.doc(`tenants/${tenantId}/debtorSendState/${debtData.debtorId}`);

  const tenantPlan: PlanId = isValidPlanId(tenantData.plan) ? tenantData.plan : 'free';
  const whatsappAllowed = PLANS[tenantPlan].whatsappEnabled;

  let effectiveChannel: Channel;
  if (channel === 'whatsapp' && !whatsappAllowed) {
    if (trigger === 'cron') {
      effectiveChannel = 'sms';
    } else {
      throw new HttpError(
        409,
        'Le canal WhatsApp est réservé aux forfaits Pro et Business.',
        'whatsapp_plan_restricted'
      );
    }
  } else if (channel === 'whatsapp' || channel === 'sms') {
    effectiveChannel = channel;
  } else {
    effectiveChannel = debtorData.preferredChannel === 'whatsapp' && whatsappAllowed ? 'whatsapp' : 'sms';
  }

  const todayDouala = getTodayDoualaDate(nowDate);
  const currentMonth = getCurrentDoualaMonth(nowDate);
  const daysOverdue = getDaysOverdue(debtData.dueDate, todayDouala);
  const effectiveTone: Tone =
    tone || pickEscalatedTone(daysOverdue, Boolean(tenantData.autoEscalate));

  const hasRealProvider =
    Boolean(secrets.whatsappAccessToken && secrets.whatsappPhoneNumberId) ||
    Boolean(secrets.smsProviderUrl && secrets.smsApiKey);

  // Réservation atomique et transactionnelle :
  // - suppression irréversible (STOP)
  // - téléphone propriétaire vérifié + numéro concordant si fournisseur réel configuré
  // - délai minimum 24h sur la dette
  // - plafond hebdomadaire 3 relances / 7 jours glissants (debtorSendState)
  // - quota mensuel + plafond journalier
  const reservation = await db.runTransaction(async (tx) => {
    const [
      freshTenantSnap,
      freshSecuritySnap,
      freshDebtSnap,
      freshSendStateSnap,
      freshSuppressionSnap,
    ] = await Promise.all([
      tx.get(tenantRef),
      tx.get(securityRef),
      tx.get(debtRef),
      tx.get(sendStateRef),
      tx.get(suppressionRef),
    ]);

    if (!freshTenantSnap.exists) {
      throw new HttpError(404, 'Entreprise introuvable.', 'tenant_not_found');
    }
    if (!freshDebtSnap.exists) {
      throw new HttpError(404, 'Dette introuvable pour cette entreprise.', 'debt_not_found');
    }
    if (freshSuppressionSnap.exists) {
      throw new HttpError(
        409,
        `${debtorData.name} a demandé l’arrêt des messages (Opt-out actif).`,
        'opt_out'
      );
    }

    const freshTenant = freshTenantSnap.data() as {
      phone?: string;
      plan?: string;
      maxRemindersPerMonth?: number;
      maxRemindersPerDay?: number;
      remindersUsedThisMonth?: number;
      quotaResetMonth?: string;
    };
    const freshSec = freshSecuritySnap.exists
      ? (freshSecuritySnap.data() as {
          phoneVerified?: boolean;
          phoneVerifiedNumber?: string;
          dailyUsage?: { date?: string; count?: number };
        })
      : {};
    const freshDebt = freshDebtSnap.data() as {
      remainingAmount?: number;
      status?: string;
      lastReminderAt?: string;
      appliedRuleOffsets?: unknown[];
      ruleReminderCounts?: Record<string, unknown>;
    };

    if (freshDebt.status === 'payee' || freshDebt.status === 'annulee' || Number(freshDebt.remainingAmount) <= 0) {
      throw new HttpError(
        409,
        'Relance impossible : cette dette est déjà payée ou annulée.',
        'debt_settled_or_cancelled'
      );
    }

    if (
      hasRealProvider &&
      (freshSec.phoneVerified !== true || freshSec.phoneVerifiedNumber !== freshTenant.phone)
    ) {
      throw new HttpError(
        403,
        'Vérifiez le téléphone du propriétaire dans Paramètres.',
        'phone_not_verified'
      );
    }

    // Délai minimum de 24h entre deux relances sur la même dette (dans la transaction)
    const previousLastReminderAt = freshDebt.lastReminderAt;
    if (previousLastReminderAt) {
      const lastSentMs = Date.parse(previousLastReminderAt);
      if (Number.isFinite(lastSentMs) && nowMs - lastSentMs < 24 * 60 * 60 * 1000) {
        throw new HttpError(
          409,
          'Une relance a déjà été envoyée il y a moins de 24 heures pour cette dette.',
          'cooldown_24h'
        );
      }
    }

    // Maximum 3 relances sur 7 jours glissants pour un même débiteur (toutes dettes confondues)
    const sevenDaysAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const rawTimestamps = freshSendStateSnap.exists
      ? (freshSendStateSnap.data() as { sentTimestamps?: unknown[] }).sentTimestamps
      : [];
    const validRecentTimestamps = Array.isArray(rawTimestamps)
      ? rawTimestamps
          .map((ts) => Number(ts))
          .filter((ts) => Number.isFinite(ts) && ts >= sevenDaysAgoMs)
      : [];

    if (validRecentTimestamps.length >= 3) {
      throw new HttpError(
        409,
        'Limite anti-harcèlement atteinte : maximum 3 relances sur 7 jours glissants pour ce débiteur.',
        'debtor_weekly_cap'
      );
    }

    const planKey: PlanId = isValidPlanId(freshTenant.plan) ? freshTenant.plan : 'free';
    const maxAllowed = Number(freshTenant.maxRemindersPerMonth ?? PLANS[planKey].maxRemindersPerMonth);
    const currentUsed =
      freshTenant.quotaResetMonth === currentMonth ? Number(freshTenant.remindersUsedThisMonth || 0) : 0;

    if (currentUsed >= maxAllowed) {
      throw new HttpError(
        429,
        `Quota mensuel atteint (${currentUsed}/${maxAllowed}). Passez au forfait supérieur pour continuer.`,
        'monthly_quota_reached'
      );
    }

    const maxDaily = Number(freshTenant.maxRemindersPerDay ?? PLANS[planKey].maxRemindersPerDay);
    const currentDailyCount =
      freshSec.dailyUsage?.date === todayDouala ? Number(freshSec.dailyUsage.count || 0) : 0;

    if (currentDailyCount >= maxDaily) {
      throw new HttpError(
        429,
        `Plafond journalier atteint (${currentDailyCount}/${maxDaily} relances aujourd’hui). Réessayez demain ou changez de forfait.`,
        'daily_quota_reached'
      );
    }

    tx.update(tenantRef, {
      remindersUsedThisMonth: currentUsed + 1,
      quotaResetMonth: currentMonth,
      updatedAt: fieldValue.serverTimestamp(),
    });

    tx.set(
      securityRef,
      {
        dailyUsage: { date: todayDouala, count: currentDailyCount + 1 },
        updatedAt: fieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.update(debtRef, {
      lastReminderAt: reservedNowIso,
      updatedAt: fieldValue.serverTimestamp(),
    });

    tx.set(
      sendStateRef,
      {
        tenantId,
        debtorId: debtData.debtorId,
        sentTimestamps: [...validRecentTimestamps, nowMs],
        updatedAt: fieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const appliedRuleOffsets = Array.isArray(freshDebt.appliedRuleOffsets)
      ? freshDebt.appliedRuleOffsets.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [];
    const ruleReminderCounts: Record<string, number> = {};
    if (freshDebt.ruleReminderCounts && typeof freshDebt.ruleReminderCounts === 'object') {
      for (const [k, v] of Object.entries(freshDebt.ruleReminderCounts)) {
        const num = Number(v);
        if (Number.isFinite(num)) {
          ruleReminderCounts[k] = num;
        }
      }
    }

    return {
      previousLastReminderAt,
      appliedRuleOffsets,
      ruleReminderCounts,
    };
  });

  // Remboursement garanti (quotas, lastReminderAt, debtorSendState) si exception avant envoi réussi
  let sentSuccessfully = false;
  try {
    const tplSnap = await db.collection(`tenants/${tenantId}/messageTemplates`).get();
    const templates = tplSnap.docs.map(
      (d) => d.data() as { tone: Tone; channel: Channel; body: string; metaTemplateName?: string }
    );
    const tplPool = templates.length > 0 ? templates : DEFAULT_TEMPLATES;
    const candidateTpl =
      tplPool.find((t) => t.tone === effectiveTone && t.channel === effectiveChannel) ||
      tplPool.find((t) => t.tone === effectiveTone) ||
      tplPool[0];

    const defaultTpl =
      DEFAULT_TEMPLATES.find((t) => t.tone === effectiveTone && t.channel === effectiveChannel) ||
      DEFAULT_TEMPLATES[0];
    const tplCheck = validateTemplateBody(candidateTpl.body, effectiveChannel);
    const selectedTpl = tplCheck.ok ? candidateTpl : defaultTpl;

    const createSms = deps.providers?.createSmsProvider ?? defaultCreateSmsProvider;
    const createPay = deps.providers?.createPaymentProvider ?? defaultCreatePaymentProvider;
    const sendWa = deps.providers?.sendWhatsAppTemplateMessage ?? defaultSendWhatsApp;

    const smsProvider = createSms(secrets);
    const paymentProvider = createPay(secrets);

    const linkRes = await paymentProvider.createPaymentLink({
      tenantId,
      debtId,
      amountFcfa: debtData.remainingAmount,
      customerPhone: debtorData.phone,
      customerName: debtorData.name,
      description: debtData.description || 'Règlement créance',
      metadata: {
        type: 'debt',
        tenantId,
        debtId,
      },
    });
    const paymentUrl = linkRes.paymentUrl;

    const renderedBody = renderTemplateMessage(selectedTpl.body, {
      nom: debtorData.name,
      montant_restant: debtData.remainingAmount,
      echeance: debtData.dueDate,
      entreprise: tenantData.name,
      lien_paiement: paymentUrl,
    }).slice(0, 2000);

    const smsBodyWithStop = appendSmsStopNotice(renderedBody, SMS_MAX_LENGTH);

    let result: {
      success: boolean;
      simulated: boolean;
      providerMessageId: string;
      status: 'simule' | 'envoyee' | 'echouee';
      errorMessage?: string;
    };
    let usedFallback = false;
    const allowSmsFallback = Boolean(tenantData.fallbackToSms);
    let loggedContent = renderedBody;

    if (effectiveChannel === 'whatsapp') {
      result = await sendWa({
        accessToken: secrets.whatsappAccessToken,
        phoneNumberId: secrets.whatsappPhoneNumberId,
        to: debtorData.phone,
        templateName: selectedTpl.metaTemplateName || `payreminder_${effectiveTone}_fr`,
        variables: [debtorData.name, String(debtData.remainingAmount), debtData.dueDate, tenantData.name],
        fallbackBody: smsBodyWithStop,
      });

      if (!result.success && allowSmsFallback) {
        usedFallback = true;
        effectiveChannel = 'sms';
        loggedContent = smsBodyWithStop;
        result = await smsProvider.sendSms({
          to: debtorData.phone,
          message: smsBodyWithStop,
        });
      }
    } else {
      loggedContent = smsBodyWithStop;
      result = await smsProvider.sendSms({
        to: debtorData.phone,
        message: smsBodyWithStop,
      });
    }

    const remId = makeDocId('rem');
    const logId = makeDocId('log');
    const batch = db.batch();

    batch.set(db.doc(`tenants/${tenantId}/reminders/${remId}`), {
      tenantId,
      debtId,
      debtorId: debtData.debtorId,
      scheduledAt: reservedNowIso,
      channel: effectiveChannel,
      tone: effectiveTone,
      status: result.status === 'echouee' ? 'echouee' : 'envoyee',
      providerMessageId: result.providerMessageId,
      createdAt: fieldValue.serverTimestamp(),
      updatedAt: fieldValue.serverTimestamp(),
    });

    batch.set(db.doc(`tenants/${tenantId}/messageLogs/${logId}`), {
      tenantId,
      debtId,
      debtorId: debtData.debtorId,
      debtorName: debtorData.name,
      debtorPhone: debtorData.phone,
      reminderId: remId,
      direction: 'outbound',
      channel: effectiveChannel,
      tone: effectiveTone,
      content: loggedContent,
      status: result.status,
      providerMessageId: result.providerMessageId,
      detectedIntent: 'none',
      createdAt: fieldValue.serverTimestamp(),
    });

    if (result.success && result.status !== 'echouee') {
      const debtUpdate: Record<string, unknown> = {
        reminderCount: fieldValue.increment(1),
        lastReminderAt: reservedNowIso,
        paymentLink: paymentUrl,
        updatedAt: fieldValue.serverTimestamp(),
      };

      if (trigger === 'cron' && typeof params.ruleOffsetDays === 'number') {
        const nextAppliedOffsets = [...reservation.appliedRuleOffsets];
        if (!nextAppliedOffsets.includes(params.ruleOffsetDays)) {
          nextAppliedOffsets.push(params.ruleOffsetDays);
        }
        const offsetKey = String(params.ruleOffsetDays);
        const nextRuleCounts = {
          ...reservation.ruleReminderCounts,
          [offsetKey]: Number(reservation.ruleReminderCounts[offsetKey] || 0) + 1,
        };
        debtUpdate.appliedRuleOffsets = nextAppliedOffsets;
        debtUpdate.ruleReminderCounts = nextRuleCounts;
      }

      batch.update(debtRef, debtUpdate);
    }

    await batch.commit();

    if (!result.success || result.status === 'echouee') {
      throw new HttpError(
        502,
        result.errorMessage || 'Échec de l’envoi de la relance.',
        'provider_failed'
      );
    }

    sentSuccessfully = true;

    if (trigger === 'manual') {
      await writeAuditLog(
        db,
        fieldValue,
        {
          tenantId,
          action: 'manual_reminder',
          actorUid: params.actorUid || 'unknown',
          targetId: debtId,
          summary: `Relance manuelle envoyée (${effectiveChannel.toUpperCase()}, ton ${effectiveTone})`,
          metadata: {
            reminderId: remId,
            channel: effectiveChannel,
            tone: effectiveTone,
            simulated: result.simulated,
          },
        },
        nowFn()
      );
    }

    return {
      ok: true,
      reminderId: remId,
      logId,
      channel: effectiveChannel,
      tone: effectiveTone,
      usedFallback,
      status: result.status === 'simule' ? 'simule' : 'envoyee',
      simulated: result.simulated,
      providerMessageId: result.providerMessageId,
      paymentUrl,
      renderedContent: loggedContent,
      trigger,
    };
  } finally {
    if (!sentSuccessfully) {
      await rollbackReminderReservation({
        db,
        fieldValue,
        tenantRef,
        securityRef,
        debtRef,
        sendStateRef,
        currentMonth,
        todayDouala,
        reservedNowMs: nowMs,
        reservedNowIso,
        previousLastReminderAt: reservation.previousLastReminderAt,
        logger: log,
      });
    }
  }
}

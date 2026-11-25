import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createServer as createViteServer } from 'vite';
import { createPaymentProvider } from './functions/src/services/payment';
import { createSmsProvider } from './functions/src/services/sms';
import { analyzeInboundMessage, sendWhatsAppTemplateMessage } from './functions/src/services/whatsapp';
import { adminAuth, adminDb, FieldValue } from './server/firebaseAdmin';
import type { Channel, PlanId, Tone } from './src/types/payreminder';
import { DEFAULT_TEMPLATES } from './src/utils/defaults';
import {
  getCurrentDoualaMonth,
  getDaysOverdue,
  pickEscalatedTone,
  renderTemplateMessage,
} from './src/utils/formatters';
import { PLANS } from './src/utils/plans';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

interface AuthContext {
  uid: string;
  email: string;
}

interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
  rawBody?: Buffer;
}

class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function getServerSecrets() {
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
    allowPlanChangeWithoutPayment: process.env.ALLOW_PLAN_CHANGE_WITHOUT_PAYMENT === 'true',
    appBaseUrl: process.env.APP_URL || 'http://localhost:3000',
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyWebhookHmac(params: {
  rawBody?: Buffer;
  signatureHeader?: string;
  secret: string;
  secretEnvName: string;
}): { ok: boolean; error?: string } {
  if (!params.secret) {
    if (process.env.NODE_ENV !== 'production') {
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

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && VALID_ID_REGEX.test(value);
}

// ============================================================================
// ÉTAPE 1 : Middlewares d'authentification et contrôle multi-tenant
// ============================================================================
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

    const decoded = await adminAuth.verifyIdToken(idToken);
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

async function requireTenantMember(
  uid: string,
  tenantId: string
): Promise<{ role: 'owner' | 'staff'; status: string; name: string; email: string }> {
  if (!isValidId(tenantId)) {
    throw new HttpError(400, 'Identifiant entreprise invalide.');
  }
  const memberSnap = await adminDb.doc(`tenants/${tenantId}/users/${uid}`).get();
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

function handleRouteError(res: Response, error: unknown, fallbackMsg: string): void {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  res.status(500).json({
    error: error instanceof Error ? error.message : fallbackMsg,
  });
}

function makeDocId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

async function startServer() {
  const app = express();

  // Durcissement en-têtes HTTP (sans bloquer les scripts inline Vite dev ni l'iframe de prévisualisation)
  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // Limite JSON à 100 ko tout en conservant le corps brut (rawBody) pour la vérification HMAC des webhooks
  app.use(
    express.json({
      limit: '100kb',
      verify: (req, _res, buf) => {
        (req as AuthenticatedRequest).rawBody = buf;
      },
    })
  );

  // 1. Capacités serveur (sans jamais exposer les clés API)
  app.get('/api/config/capabilities', (_req, res) => {
    const secrets = getServerSecrets();
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
      timezone: 'Africa/Douala',
    });
  });

  // ============================================================================
  // ÉTAPE 2 : Changement de forfait sécurisé côté serveur
  // ============================================================================
  app.post('/api/billing/change-plan', requireAuth, uidRateLimiter, async (req, res) => {
    try {
      const { uid } = (req as AuthenticatedRequest).auth!;
      const { tenantId, planId } = req.body as { tenantId?: unknown; planId?: unknown };

      if (!isValidId(tenantId) || typeof planId !== 'string' || !(planId in PLANS)) {
        res.status(400).json({ error: 'Paramètres de forfait invalides.' });
        return;
      }

      await requireTenantOwner(uid, tenantId);

      const secrets = getServerSecrets();
      // NOTE : Tant que le paiement Mobile Money d'abonnement n'est pas relié, le changement
      // direct est bloqué en production (402) sauf si ALLOW_PLAN_CHANGE_WITHOUT_PAYMENT="true".
      // Lorsque la facturation SaaS sera branchée, le webhook paiement vérifié appliquera la mise à niveau.
      if (!secrets.allowPlanChangeWithoutPayment) {
        res.status(402).json({ error: "Le paiement de l'abonnement est requis." });
        return;
      }

      const validPlanId = planId as PlanId;
      const planDef = PLANS[validPlanId];

      await adminDb.doc(`tenants/${tenantId}`).update({
        plan: validPlanId,
        maxDebtors: planDef.maxDebtors,
        maxRemindersPerMonth: planDef.maxRemindersPerMonth,
        subscriptionDate: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      res.json({
        ok: true,
        plan: validPlanId,
        maxDebtors: planDef.maxDebtors,
        maxRemindersPerMonth: planDef.maxRemindersPerMonth,
      });
    } catch (error) {
      handleRouteError(res, error, 'Erreur lors du changement de forfait.');
    }
  });

  // ============================================================================
  // ÉTAPE 3 : Envoi d'une relance 100 % piloté par Firestore côté serveur
  // ============================================================================
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

      // Lecture autoritaire depuis Firestore (le client ne fournit ni montant, ni numéro, ni texte, ni plan)
      const tenantRef = adminDb.doc(`tenants/${tenantId}`);
      const debtRef = adminDb.doc(`tenants/${tenantId}/debts/${debtId}`);

      const [tenantSnap, debtSnap] = await Promise.all([tenantRef.get(), debtRef.get()]);
      if (!tenantSnap.exists) {
        res.status(404).json({ error: 'Entreprise introuvable.' });
        return;
      }
      if (!debtSnap.exists) {
        res.status(404).json({ error: 'Dette introuvable pour cette entreprise.' });
        return;
      }

      const tenantData = tenantSnap.data() as {
        name: string;
        plan?: string;
        maxRemindersPerMonth?: number;
        remindersUsedThisMonth?: number;
        quotaResetMonth?: string;
        autoEscalate?: boolean;
        fallbackToSms?: boolean;
      };
      const debtData = debtSnap.data() as {
        debtorId: string;
        remainingAmount: number;
        dueDate: string;
        status: string;
        description?: string;
      };

      if (debtData.status === 'payee' || debtData.status === 'annulee' || Number(debtData.remainingAmount) <= 0) {
        res.status(409).json({ error: 'Relance impossible : cette dette est déjà payée ou annulée.' });
        return;
      }

      const debtorSnap = await adminDb.doc(`tenants/${tenantId}/debtors/${debtData.debtorId}`).get();
      if (!debtorSnap.exists) {
        res.status(404).json({ error: 'Débiteur associé introuvable.' });
        return;
      }

      const debtorData = debtorSnap.data() as {
        name: string;
        phone: string;
        preferredChannel?: Channel;
        optOut?: boolean;
      };

      if (debtorData.optOut === true) {
        res.status(409).json({ error: `${debtorData.name} a demandé l’arrêt des messages (Opt-out actif).` });
        return;
      }

      if (!debtorData.phone || !/^\+[1-9][0-9]{7,15}$/.test(debtorData.phone)) {
        res.status(409).json({ error: 'Numéro de téléphone du débiteur invalide.' });
        return;
      }

      const tenantPlan: PlanId =
        tenantData.plan && tenantData.plan in PLANS ? (tenantData.plan as PlanId) : 'free';
      const whatsappAllowed = PLANS[tenantPlan].whatsappEnabled;

      let effectiveChannel: Channel;
      if (channel === 'whatsapp' && !whatsappAllowed) {
        res.status(409).json({ error: 'Le canal WhatsApp est réservé aux forfaits Pro et Business.' });
        return;
      } else if (channel === 'whatsapp' || channel === 'sms') {
        effectiveChannel = channel;
      } else {
        effectiveChannel = debtorData.preferredChannel === 'whatsapp' && whatsappAllowed ? 'whatsapp' : 'sms';
      }

      const daysOverdue = getDaysOverdue(debtData.dueDate);
      const effectiveTone: Tone =
        (tone as Tone | undefined) || pickEscalatedTone(daysOverdue, Boolean(tenantData.autoEscalate));

      // Chargement des modèles de l'entreprise (ou repli sur les modèles par défaut)
      const tplSnap = await adminDb.collection(`tenants/${tenantId}/messageTemplates`).get();
      const templates = tplSnap.docs.map((d) => d.data() as { tone: Tone; channel: Channel; body: string; metaTemplateName?: string });
      const tplPool = templates.length > 0 ? templates : DEFAULT_TEMPLATES;
      const selectedTpl =
        tplPool.find((t) => t.tone === effectiveTone && t.channel === effectiveChannel) ||
        tplPool.find((t) => t.tone === effectiveTone) ||
        tplPool[0];

      // Réservation transactionnelle du quota AVANT l'envoi
      const currentMonth = getCurrentDoualaMonth();
      await adminDb.runTransaction(async (tx) => {
        const freshTenantSnap = await tx.get(tenantRef);
        if (!freshTenantSnap.exists) {
          throw new HttpError(404, 'Entreprise introuvable.');
        }
        const freshTenant = freshTenantSnap.data() as {
          plan?: string;
          maxRemindersPerMonth?: number;
          remindersUsedThisMonth?: number;
          quotaResetMonth?: string;
        };
        const planKey: PlanId = freshTenant.plan && freshTenant.plan in PLANS ? (freshTenant.plan as PlanId) : 'free';
        const maxAllowed = Number(freshTenant.maxRemindersPerMonth ?? PLANS[planKey].maxRemindersPerMonth);
        const currentUsed =
          freshTenant.quotaResetMonth === currentMonth ? Number(freshTenant.remindersUsedThisMonth || 0) : 0;

        if (currentUsed >= maxAllowed) {
          throw new HttpError(
            429,
            `Quota mensuel atteint (${currentUsed}/${maxAllowed}). Passez au forfait supérieur pour continuer.`
          );
        }

        tx.update(tenantRef, {
          remindersUsedThisMonth: currentUsed + 1,
          quotaResetMonth: currentMonth,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      const secrets = getServerSecrets();
      const smsProvider = createSmsProvider(secrets);
      const paymentProvider = createPaymentProvider(secrets);

      const linkRes = await paymentProvider.createPaymentLink({
        tenantId,
        debtId,
        amountFcfa: debtData.remainingAmount,
        customerPhone: debtorData.phone,
        customerName: debtorData.name,
        description: debtData.description || 'Règlement créance',
      });
      const paymentUrl = linkRes.paymentUrl;

      const finalBody = renderTemplateMessage(selectedTpl.body, {
        nom: debtorData.name,
        montant_restant: debtData.remainingAmount,
        echeance: debtData.dueDate,
        entreprise: tenantData.name,
        lien_paiement: paymentUrl,
      }).slice(0, 2000);

      let result: {
        success: boolean;
        simulated: boolean;
        providerMessageId: string;
        status: 'simule' | 'envoyee' | 'echouee';
        errorMessage?: string;
      };
      let usedFallback = false;
      const allowSmsFallback = Boolean(tenantData.fallbackToSms);

      if (effectiveChannel === 'whatsapp') {
        result = await sendWhatsAppTemplateMessage({
          accessToken: secrets.whatsappAccessToken,
          phoneNumberId: secrets.whatsappPhoneNumberId,
          to: debtorData.phone,
          templateName: selectedTpl.metaTemplateName || `payreminder_${effectiveTone}_fr`,
          variables: [debtorData.name, String(debtData.remainingAmount), debtData.dueDate, tenantData.name],
          fallbackBody: finalBody,
        });

        if (!result.success && allowSmsFallback) {
          usedFallback = true;
          effectiveChannel = 'sms';
          result = await smsProvider.sendSms({
            to: debtorData.phone,
            message: finalBody,
          });
        }
      } else {
        result = await smsProvider.sendSms({
          to: debtorData.phone,
          message: finalBody,
        });
      }

      // Annulation de l'incrément de quota si l'envoi échoue complètement
      if (!result.success || result.status === 'echouee') {
        await adminDb.runTransaction(async (tx) => {
          const freshTenantSnap = await tx.get(tenantRef);
          if (!freshTenantSnap.exists) return;
          const freshTenant = freshTenantSnap.data() as {
            remindersUsedThisMonth?: number;
            quotaResetMonth?: string;
          };
          if (freshTenant.quotaResetMonth === currentMonth) {
            const nextUsed = Math.max(0, Number(freshTenant.remindersUsedThisMonth || 0) - 1);
            tx.update(tenantRef, {
              remindersUsedThisMonth: nextUsed,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
        });
      }

      // Écriture Reminder et MessageLog côté serveur uniquement
      const remId = makeDocId('rem');
      const logId = makeDocId('log');
      const nowIso = new Date().toISOString();
      const batch = adminDb.batch();

      batch.set(adminDb.doc(`tenants/${tenantId}/reminders/${remId}`), {
        tenantId,
        debtId,
        debtorId: debtData.debtorId,
        scheduledAt: nowIso,
        channel: effectiveChannel,
        tone: effectiveTone,
        status: result.status === 'echouee' ? 'echouee' : 'envoyee',
        providerMessageId: result.providerMessageId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      batch.set(adminDb.doc(`tenants/${tenantId}/messageLogs/${logId}`), {
        tenantId,
        debtId,
        debtorId: debtData.debtorId,
        debtorName: debtorData.name,
        debtorPhone: debtorData.phone,
        reminderId: remId,
        direction: 'outbound',
        channel: effectiveChannel,
        tone: effectiveTone,
        content: finalBody,
        status: result.status,
        providerMessageId: result.providerMessageId,
        detectedIntent: 'none',
        createdAt: FieldValue.serverTimestamp(),
      });

      if (result.success && result.status !== 'echouee') {
        batch.update(debtRef, {
          reminderCount: FieldValue.increment(1),
          lastReminderAt: nowIso,
          paymentLink: paymentUrl,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      await batch.commit();

      if (!result.success || result.status === 'echouee') {
        res.status(502).json({
          ok: false,
          error: result.errorMessage || 'Échec de l’envoi de la relance.',
          status: result.status,
        });
        return;
      }

      res.json({
        ok: true,
        reminderId: remId,
        logId,
        channel: effectiveChannel,
        tone: effectiveTone,
        usedFallback,
        status: result.status,
        simulated: result.simulated,
        providerMessageId: result.providerMessageId,
        paymentUrl,
        renderedContent: finalBody,
      });
    } catch (error) {
      handleRouteError(res, error, 'Erreur serveur lors de la relance.');
    }
  });

  // ============================================================================
  // ÉTAPE 4 : Génération de lien Mobile Money basée sur Firestore
  // ============================================================================
  app.post('/api/payments/create-link', requireAuth, uidRateLimiter, async (req, res) => {
    try {
      const { uid } = (req as AuthenticatedRequest).auth!;
      const { tenantId, debtId } = req.body as { tenantId?: unknown; debtId?: unknown };

      if (!isValidId(tenantId) || !isValidId(debtId)) {
        res.status(400).json({ error: 'Identifiants entreprise ou dette invalides.' });
        return;
      }

      await requireTenantMember(uid, tenantId);

      const debtRef = adminDb.doc(`tenants/${tenantId}/debts/${debtId}`);
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

      const debtorSnap = await adminDb.doc(`tenants/${tenantId}/debtors/${debtData.debtorId}`).get();
      if (!debtorSnap.exists) {
        res.status(404).json({ error: 'Débiteur introuvable.' });
        return;
      }
      const debtorData = debtorSnap.data() as { name: string; phone: string };

      const secrets = getServerSecrets();
      const provider = createPaymentProvider(secrets);
      const link = await provider.createPaymentLink({
        tenantId,
        debtId,
        amountFcfa: Number(debtData.remainingAmount),
        customerPhone: debtorData.phone,
        customerName: debtorData.name,
        description: debtData.description || 'Règlement créance',
      });

      await debtRef.update({
        paymentLink: link.paymentUrl,
        updatedAt: FieldValue.serverTimestamp(),
      });

      res.json(link);
    } catch (error) {
      handleRouteError(res, error, 'Erreur lors de la création du lien de paiement.');
    }
  });

  // ============================================================================
  // ÉTAPE 5 : Webhooks WhatsApp & Paiement avec vérification HMAC-SHA256
  // ============================================================================
  app.get('/api/webhooks/whatsapp', (req, res) => {
    const secrets = getServerSecrets();
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
      const secrets = getServerSecrets();
      const rawBody = (req as AuthenticatedRequest).rawBody;
      const sigHeader = req.header('x-hub-signature-256');

      const sigCheck = verifyWebhookHmac({
        rawBody,
        signatureHeader: sigHeader,
        secret: secrets.whatsappAppSecret,
        secretEnvName: 'WHATSAPP_APP_SECRET',
      });
      if (!sigCheck.ok) {
        res.status(401).json({ error: sigCheck.error });
        return;
      }

      // Format Meta Cloud API standard ou format simulateur simplifié
      const body = req.body as {
        fromPhone?: string;
        messageText?: string;
        entry?: Array<{
          changes?: Array<{
            value?: {
              messages?: Array<{
                id?: string;
                from?: string;
                text?: { body?: string };
              }>;
            };
          }>;
        }>;
      };

      const metaMsg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      const messageText = metaMsg?.text?.body || body.messageText;
      const rawFrom = metaMsg?.from || body.fromPhone || '';
      const normalizedFrom = rawFrom && !rawFrom.startsWith('+') && /^[0-9]{8,15}$/.test(rawFrom)
        ? `+${rawFrom}`
        : rawFrom;

      if (!messageText || typeof messageText !== 'string') {
        res.status(400).json({ error: 'messageText requis' });
        return;
      }

      const analysis = analyzeInboundMessage(messageText);

      // Si webhook Meta réel avec expéditeur identifié, enregistrement côté serveur
      if (metaMsg && normalizedFrom) {
        const matchedDebtors = await adminDb
          .collectionGroup('debtors')
          .where('phone', '==', normalizedFrom)
          .limit(5)
          .get();

        const batch = adminDb.batch();
        const nowIso = new Date().toISOString();
        for (const debtorDoc of matchedDebtors.docs) {
          const debtor = debtorDoc.data() as { tenantId: string; name: string; phone: string; note?: string };
          if (!debtor.tenantId) continue;
          const logId = makeDocId('log_in');
          batch.set(adminDb.doc(`tenants/${debtor.tenantId}/messageLogs/${logId}`), {
            tenantId: debtor.tenantId,
            debtorId: debtorDoc.id,
            debtorName: debtor.name,
            debtorPhone: debtor.phone,
            direction: 'inbound',
            channel: 'whatsapp',
            content: messageText.slice(0, 1500),
            status: 'recue',
            providerMessageId: metaMsg.id || `wa_in_${Date.now()}`,
            detectedIntent: analysis.intent,
            ...(analysis.promiseDate ? { promiseDate: analysis.promiseDate } : {}),
            createdAt: FieldValue.serverTimestamp(),
          });

          if (analysis.intent === 'opt_out') {
            batch.update(debtorDoc.ref, {
              optOut: true,
              updatedAt: FieldValue.serverTimestamp(),
            });
          } else if (analysis.intent === 'promise' && analysis.promiseDate) {
            const updatedNote = `${debtor.note ? `${debtor.note} | ` : ''}Promesse (${analysis.promiseDate}) : ${messageText}`.slice(0, 500);
            batch.update(debtorDoc.ref, {
              promiseDate: analysis.promiseDate,
              note: updatedNote,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
        }
        if (!matchedDebtors.empty) {
          await batch.commit();
        }
      }

      res.json({
        ok: true,
        fromPhone: normalizedFrom,
        intent: analysis.intent,
        promiseDate: analysis.promiseDate || null,
      });
    } catch (error) {
      handleRouteError(res, error, 'Erreur lors du traitement du webhook WhatsApp.');
    }
  });

  app.post('/api/webhooks/payment', async (req, res) => {
    try {
      const secrets = getServerSecrets();
      const rawBody = (req as AuthenticatedRequest).rawBody;
      const sigHeader = req.header('x-payment-signature') || req.header('x-hub-signature-256');

      const sigCheck = verifyWebhookHmac({
        rawBody,
        signatureHeader: sigHeader,
        secret: secrets.paymentWebhookSecret,
        secretEnvName: 'PAYMENT_WEBHOOK_SECRET',
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
        metadata?: { tenantId?: unknown };
      };

      const resolvedTenantId = tenantId ?? metadata?.tenantId;
      if (!isValidId(resolvedTenantId) || !isValidId(debtId)) {
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

      const cleanRef = transactionRef.trim();
      const safePayDocId = `pay_wh_${cleanRef.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96)}`;
      const safeMethod = method === 'orange_money' ? 'orange_money' : 'mtn_momo';

      const paymentDocRef = adminDb.doc(`tenants/${resolvedTenantId}/payments/${safePayDocId}`);
      const debtDocRef = adminDb.doc(`tenants/${resolvedTenantId}/debts/${debtId}`);

      const txResult = await adminDb.runTransaction(async (tx) => {
        const existingPay = await tx.get(paymentDocRef);
        if (existingPay.exists) {
          return { idempotent: true, amount: numericAmount };
        }

        const debtSnap = await tx.get(debtDocRef);
        if (!debtSnap.exists) {
          throw new HttpError(404, 'Dette introuvable.');
        }

        const debt = debtSnap.data() as {
          debtorId: string;
          debtorName: string;
          remainingAmount: number;
          status: string;
        };

        if (debt.status === 'payee' || debt.status === 'annulee') {
          throw new HttpError(409, 'Cette dette est déjà soldée ou annulée.');
        }

        const expectedRemaining = Math.round(Number(debt.remainingAmount));
        if (numericAmount !== expectedRemaining) {
          throw new HttpError(
            400,
            `Montant reçu (${numericAmount} FCFA) non conforme au solde dû (${expectedRemaining} FCFA).`
          );
        }

        const nowIso = new Date().toISOString();
        const receiptNumber = `REC-${nowIso.slice(0, 4)}-${cleanRef.slice(-6).toUpperCase()}`;

        tx.set(paymentDocRef, {
          tenantId: resolvedTenantId,
          debtId,
          debtorId: debt.debtorId,
          debtorName: debt.debtorName,
          amount: numericAmount,
          paidAt: nowIso,
          method: safeMethod,
          note: `Paiement confirmé via webhook Mobile Money (${cleanRef})`.slice(0, 300),
          receiptNumber,
          transactionRef: cleanRef,
          createdBy: 'webhook_payment',
          createdAt: FieldValue.serverTimestamp(),
        });

        tx.update(debtDocRef, {
          remainingAmount: 0,
          status: 'payee',
          updatedAt: FieldValue.serverTimestamp(),
        });

        return { idempotent: false, amount: numericAmount };
      });

      res.json({
        ok: true,
        verified: true,
        idempotent: txResult.idempotent,
        debtId,
        amount: txResult.amount,
        method: safeMethod,
        transactionRef: cleanRef,
      });
    } catch (error) {
      handleRouteError(res, error, 'Erreur lors du traitement du webhook paiement.');
    }
  });

  // ============================================================================
  // ÉTAPE 4 : Route CRON protégée par x-cron-secret + route utilisateur ReportsPage
  // ============================================================================
  app.post('/api/reports/send-monthly', async (req, res) => {
    try {
      const secrets = getServerSecrets();
      if (!secrets.cronSecret) {
        res.status(503).json({ error: 'CRON_SECRET non configuré sur le serveur.' });
        return;
      }

      const providedSecret = req.header('x-cron-secret') || '';
      if (!constantTimeEquals(providedSecret, secrets.cronSecret)) {
        res.status(401).json({ error: 'Secret cron invalide.' });
        return;
      }

      const monthKey =
        typeof req.body?.monthKey === 'string' && /^[0-9]{4}-[0-9]{2}$/.test(req.body.monthKey)
          ? (req.body.monthKey as string)
          : getCurrentDoualaMonth();

      const tenantsSnap = await adminDb
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
          adminDb.collection(`tenants/${tenantDoc.id}/debts`).get(),
          adminDb.collection(`tenants/${tenantDoc.id}/payments`).get(),
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

        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secrets.emailProviderApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: secrets.emailFromAddress,
            to: [t.email],
            subject: `PayReminder — Rapport ${monthLabel} (${t.name})`,
            html: `<h2>Rapport mensuel ${t.name}</h2><p>Restant dû : ${totalDue} FCFA</p><p>Encaissé ce mois : ${collectedThisMonth} FCFA</p><p>Taux de récupération : ${recoveryRate}%</p>`,
          }),
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
      handleRouteError(res, error, 'Erreur lors de l’envoi des rapports mensuels.');
    }
  });

  // Route authentifiée pour le bouton "Envoyer par email" dans ReportsPage (calcule depuis Firestore)
  app.post('/api/reports/send-tenant-email', requireAuth, uidRateLimiter, async (req, res) => {
    try {
      const { uid } = (req as AuthenticatedRequest).auth!;
      const { tenantId, monthKey } = req.body as { tenantId?: unknown; monthKey?: unknown };

      if (!isValidId(tenantId)) {
        res.status(400).json({ error: 'Identifiant entreprise invalide.' });
        return;
      }

      await requireTenantMember(uid, tenantId);

      const tenantSnap = await adminDb.doc(`tenants/${tenantId}`).get();
      if (!tenantSnap.exists) {
        res.status(404).json({ error: 'Entreprise introuvable.' });
        return;
      }

      const tenant = tenantSnap.data() as { name: string; email: string; plan?: string };
      const planKey: PlanId = tenant.plan && tenant.plan in PLANS ? (tenant.plan as PlanId) : 'free';
      if (!PLANS[planKey].reportsEnabled) {
        res.status(403).json({ error: 'Les rapports avancés sont réservés aux forfaits Pro et Business.' });
        return;
      }

      const targetMonth =
        typeof monthKey === 'string' && /^[0-9]{4}-[0-9]{2}$/.test(monthKey)
          ? monthKey
          : getCurrentDoualaMonth();

      const [debtsSnap, paymentsSnap] = await Promise.all([
        adminDb.collection(`tenants/${tenantId}/debts`).get(),
        adminDb.collection(`tenants/${tenantId}/payments`).get(),
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

      const secrets = getServerSecrets();
      if (!secrets.emailProviderApiKey) {
        res.json({
          ok: true,
          simulated: true,
          message: `Rapport mensuel simulé pour ${tenant.email} (aucune clé EMAIL_PROVIDER_API_KEY configurée).`,
        });
        return;
      }

      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secrets.emailProviderApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: secrets.emailFromAddress,
          to: [tenant.email],
          subject: `PayReminder — Rapport ${monthLabel} (${tenant.name})`,
          html: `<h2>Rapport mensuel ${tenant.name}</h2><p>Restant dû : ${totalDue} FCFA</p><p>Encaissé ce mois : ${collectedThisMonth} FCFA</p><p>Taux de récupération : ${recoveryRate}%</p>`,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        res.status(502).json({ error: `Échec envoi email: ${err.slice(0, 160)}` });
        return;
      }

      res.json({
        ok: true,
        simulated: false,
        message: `Rapport mensuel envoyé à ${tenant.email}.`,
      });
    } catch (error) {
      handleRouteError(res, error, 'Erreur lors de l’envoi du rapport par email.');
    }
  });

  // Vite dev middleware vs static production serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build introuvable. Exécutez npm run build.');
      }
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, '0.0.0.0', () => {
    console.info(`PayReminder server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
